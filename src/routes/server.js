const express=require("express");

const app=express();


const imageRoute=require("./routes/image");


app.use(express.json());


    app.use("/api/image",imageRoute);



app.listen(5000,()=>{

console.log("Server running");

});