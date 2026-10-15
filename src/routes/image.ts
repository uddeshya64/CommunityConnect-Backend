import { Router, Request, Response } from "express";
import upload from "../middlewares/upload";
import supabase from "../config/supabase";
import prisma from "../config/prisma";
import router from "./auth.routes";
import { authenticate } from "../middlewares/auth.middleware";

router.post(
"/upload",
   authenticate,
upload.single("image"),

async(req:Request,res:Response)=>{

try{

const file=req.file;


if(!file){
 return res.status(400).json({
   message:"Image required"
 });
}


const fileName =
`${Date.now()}-${file.originalname}`;


const {error}=await supabase
.storage
.from("image-bucket")
.upload(
 fileName,
 file.buffer,
 {
  contentType:file.mimetype
 }
);


if(error){
 throw error;
}


const imageURL =
supabase
.storage
.from("image-bucket")
.getPublicUrl(fileName)
.data
.publicUrl;



if (!req.user) {
    return res.status(401).json({
        message:"Unauthorized user"
    });
}


const userId = req.user.id;



await prisma.user.update({

where:{
 id:userId
},

data:{
 avatar_url:imageURL
}

});


return res.status(200).json({
 message:"Avatar uploaded successfully",
 url:imageURL
});


}
catch(error:any){

return res.status(500).json({
 error:error.message
});

}

});


export default router;