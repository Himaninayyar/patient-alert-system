const config = require("./config");
const express=require("express");
const app=express();
const PORT=config.port;
const pool=require("./db");
const {connectQueue,getChannel}=require("./queue");
const {isDangerous} =require("./thresholds");
const { startOutboxPublisher } = require("./outbox-publisher");
const { validateVitalReading } = require("./validation");
const { UPSERT_ALERT } = require("./sql");

app.use(express.json());


app.get("/",(req,res)=>{
    res.send("server is alive");
});

app.listen(PORT, async (err) => {
  if (err) {
    console.error(`Cannot start: port ${PORT} is not available:`, err.message);
    process.exit(1);
  }

  console.log(`Server is running on http://localhost:${PORT}`);
  await connectQueue();
  startOutboxPublisher();
});


app.get("/patients",async(req,res)=>{
    try{
     const x= await pool.query("SELECT * FROM patients");
     res.status(200).json(x.rows);
    }catch(err){
      res.status(500).json({error:err.message});
    }
});



app.post("/patients", async (req, res) => {
    try{
   const{name,bed_no,ward_no}=req.body;
   const result = await pool.query("INSERT INTO patients (name,bed_no,ward_no) values ($1,$2,$3) returning *",
    [name,bed_no,ward_no]
   );
   res.status(201).json(result.rows[0]);

    }catch(err){
        if(err.code ==="23502"){
    res.status(400).json({ error: "Missing required field: " + err.column });
  } else {
    res.status(500).json({ error: err.message });
  }
    }
});

app.get("/patients/:id",async(req,res)=>{
    try{
    const{id}=req.params;
    const result=await pool.query("SELECT * FROM patients where id=$1",[id]);
    if(result.rows.length==0){
   return res.status(404).json({error:"Patient not found"});
    }
    res.status(200).json(result.rows[0]);
    }catch(err){
     res.status(500).json({ error: err.message });
    }
});


app.post("/vital-readings", async (req, res) => {
  const problem = validateVitalReading(req.body);
  if (problem) {
    return res.status(400).json({ error: problem });
  }

  const { patient_id, vital_type, value } = req.body;
  const client = await pool.connect();   // borrow ONE connection

  try {
    await client.query("BEGIN");

    const result = await client.query(
      "INSERT INTO vital_readings(patient_id,vital_type,value) VALUES($1,$2,$3) RETURNING *",
      [patient_id, vital_type, value]
    );

    if (isDangerous(vital_type, value)) {
      const alertResult = await client.query(UPSERT_ALERT, [patient_id, vital_type]);

      const alert = alertResult.rows[0];
      const isNewAlert = alert.created_at.getTime() === alert.last_seen_at.getTime();

      if (isNewAlert) {
        // the "to-do note": saved in the SAME transaction as the alert
        const messagePayload = { alertId: alert.id, vital_type, value };
        await client.query(
          "INSERT INTO outbox (alert_id, payload) VALUES ($1, $2)",
          [alert.id, messagePayload]
        );
      }
    }

    await client.query("COMMIT");          // everything saves together
    res.status(201).json(result.rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");        // any failure undoes everything
    if (err.code === "23502") {
      res.status(400).json({ error: "Missing required field: " + err.column });
    } else if (err.code === "23503") {
      res.status(400).json({ error: "Referenced patient does not exist" });
    } else {
      res.status(500).json({ error: err.message });
    }
  } finally {
    client.release();                      // always give the connection back
  }
});


app.get("/alerts",async(req,res)=>{
  try{
 const result=await pool.query("SELECT * FROM alerts "); 
    res.status(200).json(result.rows);
    }catch(err){
     res.status(500).json({ error: err.message });
    }
  }
);


app.patch("/alerts/:id/resolve", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      "UPDATE alerts SET status = 'resolved' WHERE id = $1 AND status = 'active' RETURNING *",
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "No active alert found with this id" });
    }

    res.status(200).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

