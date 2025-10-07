import { 
  users, 
  type User, 
  type InsertUser,
  type Conversation,
  type InsertConversation,
  type ConversationMessage,
  type InsertConversationMessage,
  calendarConnectors,
  calendarColleagues,
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
  
  // Calendar credentials methods
  upsertCalendarConnector(userId: string, webAppUrl: string, sharedToken: string): Promise<void>;
  getCalendarConnector(userId: string): Promise<{ userId: string; webAppUrl: string; sharedToken: string } | undefined>;
  upsertCalendarColleague(alias: string, email?: string, icsUrl?: string): Promise<void>;
  deleteCalendarColleague(alias: string): Promise<void>;
  listCalendarColleagues(): Promise<{ alias: string; email?: string | null; icsUrl?: string | null }[]>;
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
  
  async upsertCalendarConnector(userId: string, webAppUrl: string, sharedToken: string): Promise<void> {
    await db.insert(calendarConnectors)
      .values({ userId, webAppUrl, sharedToken, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: calendarConnectors.userId,
        set: { webAppUrl, sharedToken, updatedAt: new Date() }
      });
  }
  
  async getCalendarConnector(userId: string): Promise<{ userId: string; webAppUrl: string; sharedToken: string } | undefined> {
    const result = await db.select().from(calendarConnectors).where(eq(calendarConnectors.userId, userId)).limit(1);
    return result[0];
  }
  
  async upsertCalendarColleague(alias: string, email?: string, icsUrl?: string): Promise<void> {
    await db.insert(calendarColleagues)
      .values({ alias: alias.toLowerCase(), email: email || null, icsUrl: icsUrl || null, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: calendarColleagues.alias,
        set: { email: email || null, icsUrl: icsUrl || null, updatedAt: new Date() }
      });
  }
  
  async deleteCalendarColleague(alias: string): Promise<void> {
    await db.delete(calendarColleagues).where(eq(calendarColleagues.alias, alias.toLowerCase()));
  }
  
  async listCalendarColleagues(): Promise<{ alias: string; email?: string | null; icsUrl?: string | null }[]> {
    return await db.select().from(calendarColleagues);
  }
}

export const storage = new DbStorage();
