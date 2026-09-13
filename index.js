const express=require("express");
const app=express();
const PORT=3000;
const pool=require("./db");
require("dotenv").config();

app.use(express.json());


app.get("/",(req,res)=>{
    res.send("server is alive");
});

app.listen(PORT,()=>{
    console.log(`Server is running on http://localhost:${PORT}`);
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

      // Step 3: check if an active alert already exists
      const existingAlert = await pool.query(
        "SELECT * FROM alerts WHERE patient_id = $1 AND vital_type = $2 AND status = 'active'",
        [patient_id, vital_type]
      );

      // Step 4: decide - update or insert?
      if (existingAlert.rows.length > 0) {
        // TODO: update last_seen_at
        await pool.query(
        "UPDATE alerts SET last_seen_at=now() where id=$1",
        [existingAlert.rows[0].id]
      );
      } else {
        // TODO: insert new alert
        await pool.query(
          "INSERT INTO alerts(patient_id,vital_type) values($1,$2) returning * ",
          [patient_id,vital_type]
        );
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

