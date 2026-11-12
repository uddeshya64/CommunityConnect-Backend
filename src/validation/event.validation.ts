import { z } from "zod";
import { EventMode } from "@prisma/client";

// Defines the shape of one custom field the organizer builds
const CustomFieldDefinition = z.object({
  id: z.string(),
  label: z.string().min(1, "Field label is required"),
  type: z.enum([
    "text",
    "textarea",
    "number",
    "date",
    "select",
    "checkbox",
    "url",
    "phone",
    "email",
  ]),
  required: z.boolean().default(false),
  options: z.array(z.string()).optional(),
});

const optionalDateField = z.preprocess(
  (val) => {
    if (val === undefined) return undefined;
    if (val === null || (typeof val === "string" && val.trim() === "")) return null;
    return val;
  },
  z.coerce.date().nullable().optional()
);

const optionalBooleanField = z.preprocess(
  (val) => {
    if (val === undefined) return undefined;
    if (typeof val === "boolean") return val;
    if (typeof val === "string") {
      const normalized = val.trim().toLowerCase();
      if (normalized === "true" || normalized === "1") return true;
      if (normalized === "false" || normalized === "0") return false;
    }
    return val;
  },
  z.boolean().optional()
);

// Base Event Object
const EventBaseObject = z.object({
  title: z
    .string()
    .min(5, "Title must be at least 5 characters")
    .max(150),

  description: z
    .string()
    .min(20, "Description must be detailed"),

  type: z
    .string()
    .min(2, "Event type must be at least 2 characters")
    .max(50),

  mode: z.nativeEnum(EventMode),

  // Optional dates: leave blank/null to display "Coming Soon" until announced
  start_date: optionalDateField,
  end_date: optionalDateField,

  // Organizer toggle for allowing or pausing registrations
  is_registration_open: optionalBooleanField,

  registration_type: z.string(),

  // FIX: FormData sends these as strings; empty/null/omitted defaults cleanly to 0 (Free)
  registration_fee: z
    .preprocess(
      (val) =>
        val === undefined
          ? undefined
          : val === null || (typeof val === "string" && val.trim() === "")
            ? 0
            : val,
      z.coerce
        .number()
        .min(0, "Registration fee cannot be negative")
        .max(100000, "Registration fee cannot exceed ₹100,000")
    )
    .optional(),

  max_team_size: z.coerce
    .number()
    .min(1, "Maximum team size must be at least 1"),

  min_team_size: z.coerce
    .number()
    .min(1, "Minimum team size must be at least 1"),

  capacity: z.coerce
    .number()
    .int("Capacity must be an integer")
    .nonnegative("Capacity cannot be negative")
    .default(0),

  banner_url: z.preprocess(
    (val) => {
      if (typeof val === "string") {
        const trimmed = val.trim();
        return trimmed === "" ? undefined : trimmed;
      }
      return val === null ? undefined : val;
    },
    z.string().url("Please enter a valid banner URL").optional()
  ),

  remove_banner: z.union([z.boolean(), z.string()]).optional(),

  logo_url: z
    .string()
    .url()
    .optional(),

  rewards: z.any().optional(),

  custom_fields: z
    .record(z.string(), z.any())
    .optional(),

  custom_form_schema: z
    .array(CustomFieldDefinition)
    .optional(),

  registration_form_schema: z
    .array(z.any())
    .optional(),

  location: z
    .string()
    .optional(),
});


// CREATE EVENT VALIDATION
export const CreateEventSchema = EventBaseObject.refine(
  (data) => !(Boolean(data.start_date) !== Boolean(data.end_date)),
  {
    message: "Please provide both start date and end date, or leave both blank for Coming Soon",
    path: ["end_date"],
  }
).refine(
  (data) => {
    if (data.start_date && data.end_date) {
      return data.start_date < data.end_date;
    }
    return true;
  },
  {
    message: "End date must be after start date",
    path: ["end_date"],
  }
);


// UPDATE EVENT VALIDATION
export const UpdateEventSchema = EventBaseObject.partial()
  .extend({
    banner_url: z
      .preprocess(
        (val) => (typeof val === "string" ? val.trim() : val),
        z.union([z.string().url("Please enter a valid banner URL"), z.literal(""), z.null()])
      )
      .optional(),
  })
  .refine(
    (data) => {
      // Validate dates only if both are provided
      if (data.start_date && data.end_date) {
        return data.start_date < data.end_date;
      }

      return true;
    },
    {
      message: "End date must be after start date",
      path: ["end_date"],
    }
  );

// EVENT TIMELINE (AGENDA) VALIDATION
export const BaseTimelineSchema = z.object({
  title: z.string().min(1, "Title is required").max(100),
  speaker_name: z.string().max(100).optional().nullable(),
  description: z.string().optional().nullable(),
  tags: z.array(z.string().min(1).max(50)).default([]),
  start_time: z.coerce.date(),
  end_time: z.coerce.date().optional().nullable(),
  location: z.string().optional().nullable(),
  should_notify: z.boolean().default(true),
});

export const TimelineSchema = BaseTimelineSchema.refine(
  (data) => {
    if (data.start_time && data.end_time) {
      return data.start_time < data.end_time;
    }
    return true;
  },
  {
    message: "End time must be after start time",
    path: ["end_time"],
  }
);