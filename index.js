const express=require("express");
const app=express();
const PORT=3000;
const pool=require("./db");
require("dotenv").config();

app.get("/",(req,res)=>{
    res.send("server is alive");
});

app.listen(PORT,()=>{
    console.log(`Server is running on http://localhost:${PORT}`);
});
