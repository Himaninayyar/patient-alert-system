const express=require("express");
const app=express();
const PORT=3000;
const pool=require("./db");
const {connectQueue,getChannel}=require("./queue");

require("dotenv").config();

app.use(express.json());


app.get("/",(req,res)=>{
    res.send("server is alive");
});

app.listen(PORT,async()=>{
    console.log(`Server is running on http://localhost:${PORT}`);
    await connectQueue();
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
  try {
    const { patient_id, vital_type, value } = req.body;

    // Step 1: insert the vital reading (you already have this working)
    const result = await pool.query(
      "INSERT INTO vital_readings(patient_id,vital_type,value) values($1,$2,$3) RETURNING *",
      [patient_id, vital_type, value]
    );

    // Step 2: check if this reading is dangerous
if (vital_type === "heart_rate" && value > 120) {
  const alertResult = await pool.query(
    `INSERT INTO alerts (patient_id, vital_type)
     VALUES ($1, $2)
     ON CONFLICT (patient_id, vital_type) WHERE status = 'active'
     DO UPDATE SET last_seen_at = now()
     RETURNING *`,
    [patient_id, vital_type]
  );

  const alert=alertResult.rows[0];
  const isNewAlert=alert.created_at.getTime()===alert.last_seen_at.getTime();

  if(isNewAlert){
   const channel= getChannel();
   const messagePayload={alertId:alert.id,vital_type:vital_type,value:value};
  

   channel.sendToQueue(
  "alert-dispatch",
  Buffer.from(JSON.stringify(messagePayload)),
  { persistent: true }
);
   console.log("Published alert to queue :",alert.id);

}
}

    res.status(201).json(result.rows[0]);
  } catch (err) {
     if (err.code === "23502") {
      res.status(400).json({ error: "Missing required field: " + err.column });
    } else if (err.code === "23503") {
      res.status(400).json({ error: "Referenced patient does not exist" });
    } else {
      res.status(500).json({ error: err.message });
    }
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

