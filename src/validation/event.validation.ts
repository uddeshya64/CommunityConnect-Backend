import { z } from 'zod';
import { EventMode } from '@prisma/client';

// 1. Define the RAW SHAPE (The "Building Blocks")
const EventBaseObject = z.object({
  title: z.string().min(5, "Title must be at least 5 characters").max(150),
  description: z.string().min(20, "Description must be detailed"),
  type: z.string().min(2, "Event type must be at least 2 characters").max(50),
  mode: z.nativeEnum(EventMode),
  
  // Use coerce to automatically turn strings into Date objects
  start_date: z.coerce.date(),
  end_date: z.coerce.date(),
  
  registration_type: z.string(),
  registration_fee: z.number().min(0),
  max_team_size: z.number().min(1),
  min_team_size: z.number().min(1),
  
  banner_url: z.string().url().optional(),
  logo_url: z.string().url().optional(),
  rewards: z.any().optional(),
  
  location: z.string().optional(),
});

// 2. CREATE SCHEMA: Refine the raw object
export const CreateEventSchema = EventBaseObject.refine(
  (data) => data.start_date < data.end_date, 
  {
    message: "End date must be after start date",
    path: ["end_date"],
  }
);

// 3. UPDATE SCHEMA: Make partial from raw object, THEN refine
export const UpdateEventSchema = EventBaseObject.partial().refine(
  (data) => {
    // Only run the comparison if BOTH dates are provided in the update request
    if (data.start_date && data.end_date) {
      return data.start_date < data.end_date;
    }
    return true; // If only one date is updated, we assume the logic holds
  },
  {
    message: "End date must be after start date",
    path: ["end_date"],
  }
);