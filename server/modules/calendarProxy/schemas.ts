import { z } from "zod";

export const RegisterSchema = z.object({
  userId: z.string().min(1, "userId is required"),
  webAppUrl: z.string().url("Invalid web app URL"),
  sharedToken: z.string().min(8, "Shared token must be at least 8 characters"),
});

export const FreeSchema = z.object({
  userId: z.string().min(1, "userId is required"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
  durationMins: z.number().int().positive().default(30),
  tz: z.string().default("America/Los_Angeles"),
  workHours: z
    .object({
      start: z.string().regex(/^\d{2}:\d{2}$/, "Time must be HH:mm"),
      end: z.string().regex(/^\d{2}:\d{2}$/, "Time must be HH:mm"),
    })
    .optional(),
  coworkerICS: z.string().url().optional(),
});

export const ScheduleSchema = z.object({
  userId: z.string().min(1, "userId is required"),
  title: z.string().min(1, "Title is required"),
  description: z.string().default(""),
  location: z.string().default(""),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
  preferredStart: z.string().regex(/^\d{2}:\d{2}$/, "Time must be HH:mm").optional(),
  durationMins: z.number().int().positive().default(30),
  tz: z.string().default("America/Los_Angeles"),
  workHours: z
    .object({
      start: z.string().regex(/^\d{2}:\d{2}$/, "Time must be HH:mm"),
      end: z.string().regex(/^\d{2}:\d{2}$/, "Time must be HH:mm"),
    })
    .optional(),
  attendeeEmail: z.string().email().optional(),
  coworkerICS: z.string().url().optional(),
});

export type RegisterInput = z.infer<typeof RegisterSchema>;
export type FreeInput = z.infer<typeof FreeSchema>;
export type ScheduleInput = z.infer<typeof ScheduleSchema>;
