import { pgTable, text, serial, integer, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const chatSessions = pgTable("chat_sessions", {
  id: serial("id").primaryKey(),
  sessionId: text("session_id").notNull().unique(),
  persona: text("persona").notNull().default("professional"),
  tone: text("tone").notNull().default("formal"),
  voiceEnabled: boolean("voice_enabled").notNull().default(false),
  contentAgentEnabled: boolean("content_agent_enabled").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  sessionId: text("session_id").notNull(),
  role: text("role").notNull(), // 'user' | 'assistant' | 'system'
  content: text("content").notNull(),
  timestamp: timestamp("timestamp").notNull().defaultNow(),
});

export const agentTasks = pgTable("agent_tasks", {
  id: serial("id").primaryKey(),
  sessionId: text("session_id").notNull(),
  taskId: text("task_id").notNull().unique(),
  prompt: text("prompt").notNull(),
  status: text("status").notNull().default("pending"), // 'pending' | 'processing' | 'completed' | 'failed'
  progress: integer("progress").notNull().default(0),
  currentStep: text("current_step").default(""),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
});

export const artifacts = pgTable("artifacts", {
  id: serial("id").primaryKey(),
  taskId: text("task_id").notNull(),
  filename: text("filename").notNull(),
  fileType: text("file_type").notNull(),
  fileSize: integer("file_size").notNull(),
  filePath: text("file_path").notNull(),
  downloadUrl: text("download_url").notNull(),
  metadata: jsonb("metadata"), // slides count, images count, charts count, etc.
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const logs = pgTable("logs", {
  id: serial("id").primaryKey(),
  taskId: text("task_id").notNull(),
  logType: text("log_type").notNull(), // 'trace' | 'step_start' | 'step_end' | 'delivery'
  message: text("message").notNull(),
  timestamp: timestamp("timestamp").notNull().defaultNow(),
});

// Insert schemas
export const insertChatSessionSchema = createInsertSchema(chatSessions).omit({
  id: true,
  createdAt: true,
});

export const insertMessageSchema = createInsertSchema(messages).omit({
  id: true,
  timestamp: true,
});

export const insertAgentTaskSchema = createInsertSchema(agentTasks).omit({
  id: true,
  createdAt: true,
  completedAt: true,
});

export const insertArtifactSchema = createInsertSchema(artifacts).omit({
  id: true,
  createdAt: true,
});

export const insertLogSchema = createInsertSchema(logs).omit({
  id: true,
  timestamp: true,
});

// Types
export type InsertChatSession = z.infer<typeof insertChatSessionSchema>;
export type ChatSession = typeof chatSessions.$inferSelect;

export type InsertMessage = z.infer<typeof insertMessageSchema>;
export type Message = typeof messages.$inferSelect;

export type InsertAgentTask = z.infer<typeof insertAgentTaskSchema>;
export type AgentTask = typeof agentTasks.$inferSelect;

export type InsertArtifact = z.infer<typeof insertArtifactSchema>;
export type Artifact = typeof artifacts.$inferSelect;

export type InsertLog = z.infer<typeof insertLogSchema>;
export type Log = typeof logs.$inferSelect;

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});
