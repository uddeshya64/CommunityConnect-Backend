import passport from "passport";
import "dotenv/config";
import {
  Strategy as GoogleStrategy,
  Profile,
} from "passport-google-oauth20";

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      callbackURL: process.env.GOOGLE_CALLBACK_URL!,
    },

    async (
      accessToken: string,
      refreshToken: string,
      profile: Profile,
      done: (error: any, user?: any) => void
    ) => {
      try {

        // Get Google email
        const email = profile.emails?.[0]?.value;

        if (!email) {
          return done(
            new Error("Google account does not have an email")
          );
        }


        // Google unique ID
        const google_id = profile.id;


        // Google user name
        const name = profile.displayName;


        // Google profile image
        const avatar_url =
          profile.photos?.[0]?.value || null;



        // 1. Check user using Google ID
        let user = await prisma.user.findUnique({
          where: {
            google_id,
          },
        });



        // 2. If Google account not found,
        // check existing account using email
        if (!user) {

          user = await prisma.user.findUnique({
            where: {
              email,
            },
          });

        }



        // 3. Existing user login
        if (user) {


          // Existing email account
          // connect Google account
          if (!user.google_id) {


            user = await prisma.user.update({

              where: {
                id: user.id,
              },

              data: {

                google_id,

                avatar_url:
                  user.avatar_url || avatar_url,

              },

            });

          }


          return done(null, user);

        }





        // 4. New Google user registration
        const newUser = await prisma.user.create({

          data: {

            name,

            email,

            google_id,

            avatar_url,


            // Google users don't have password
            password_hash: null,


            // Required because your schema has:
            // skills String[]
            skills: [],

          },

        });



        return done(null, newUser);



      } catch (error) {

        console.error(
          "Google OAuth Error:",
          error
        );

        return done(error);

      }

    }

  )
);



export default passport;