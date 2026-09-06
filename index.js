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


