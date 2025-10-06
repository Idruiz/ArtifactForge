import { 
  users, 
  type User, 
  type InsertUser,
  type Conversation,
  type InsertConversation,
  type ConversationMessage,
  type InsertConversationMessage,
} from "@shared/schema";

// modify the interface with any CRUD methods
// you might need

export interface IStorage {
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  
  // Conversation methods
  createConversation(conversation: InsertConversation): Promise<Conversation>;
  getConversation(id: string): Promise<Conversation | undefined>;
  listConversations(userId?: string, limit?: number): Promise<Conversation[]>;
  updateConversation(id: string, updates: Partial<Conversation>): Promise<Conversation | undefined>;
  deleteConversation(id: string): Promise<void>;
  
  // Conversation message methods
  createMessage(message: InsertConversationMessage): Promise<ConversationMessage>;
  getMessages(conversationId: string): Promise<ConversationMessage[]>;
  deleteMessages(conversationId: string): Promise<void>;
}

import { db } from "./db";
import { conversations, conversationMessages } from "@shared/schema";
import { eq, desc } from "drizzle-orm";

export class DbStorage implements IStorage {
  async getUser(id: number): Promise<User | undefined> {
    const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
    return result[0];
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const result = await db.select().from(users).where(eq(users.username, username)).limit(1);
    return result[0];
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const result = await db.insert(users).values(insertUser).returning();
    return result[0];
  }
  
  async createConversation(conversation: InsertConversation): Promise<Conversation> {
    const result = await db.insert(conversations).values(conversation).returning();
    return result[0];
  }
  
  async getConversation(id: string): Promise<Conversation | undefined> {
    const result = await db.select().from(conversations).where(eq(conversations.id, id)).limit(1);
    return result[0];
  }
  
  async listConversations(userId?: string, limit: number = 10): Promise<Conversation[]> {
    let query = db.select().from(conversations).orderBy(desc(conversations.updatedAt)).limit(limit);
    
    if (userId) {
      query = db.select().from(conversations).where(eq(conversations.userId, userId)).orderBy(desc(conversations.updatedAt)).limit(limit) as any;
    }
    
    return await query;
  }
  
  async updateConversation(id: string, updates: Partial<Conversation>): Promise<Conversation | undefined> {
    const result = await db.update(conversations)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(conversations.id, id))
      .returning();
    return result[0];
  }
  
  async deleteConversation(id: string): Promise<void> {
    await db.delete(conversationMessages).where(eq(conversationMessages.conversationId, id));
    await db.delete(conversations).where(eq(conversations.id, id));
  }
  
  async createMessage(message: InsertConversationMessage): Promise<ConversationMessage> {
    const result = await db.insert(conversationMessages).values(message).returning();
    return result[0];
  }
  
  async getMessages(conversationId: string): Promise<ConversationMessage[]> {
    return await db.select().from(conversationMessages)
      .where(eq(conversationMessages.conversationId, conversationId))
      .orderBy(conversationMessages.createdAt);
  }
  
  async deleteMessages(conversationId: string): Promise<void> {
    await db.delete(conversationMessages).where(eq(conversationMessages.conversationId, conversationId));
  }
}

export const storage = new DbStorage();
