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

