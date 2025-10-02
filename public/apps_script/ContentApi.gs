// Google Apps Script Backend (ContentApi.gs)
// Deploy as: Web App with "Anyone" access
// Set ADMIN_TOKEN in Script Properties

const ADMIN_TOKEN = 'YOUR_SECRET_TOKEN';
const CONTENT_KEY = 'website_content';

function doGet(e) {
  const page = (e && e.parameter && e.parameter.page) ? String(e.parameter.page) : 'index';
  const action = e.parameter.action;
  
  if (action === 'get') {
    const section = e.parameter.section;
    const content = getContent();
    
    if (section) {
      return ContentService.createTextOutput(JSON.stringify({
        sections: { [section]: content.sections[section] || [] }
      })).setMimeType(ContentService.MimeType.JSON);
    }
    
    return ContentService.createTextOutput(JSON.stringify(content))
      .setMimeType(ContentService.MimeType.JSON);
  }
  
  const allowed = {index: true, about: true, projects: true, contact: true, admin: true};
  const pageName = allowed[page] ? page : 'index';
  
  return HtmlService.createHtmlOutputFromFile(pageName)
    .setTitle('Website')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const token = extractToken(e);
    
    const adminToken = PropertiesService.getScriptProperties().getProperty('ADMIN_TOKEN') || ADMIN_TOKEN;
    if (token !== adminToken) {
      return createResponse({ error: 'Unauthorized' }, 401);
    }
    
    const { action, section, article, id } = data;
    const content = getContent();
    
    if (!content.sections[section]) {
      content.sections[section] = [];
    }
    
    switch (action) {
      case 'create':
        content.sections[section].push(article);
        break;
        
      case 'update':
        const updateIndex = content.sections[section].findIndex(a => a.id === article.id);
        if (updateIndex !== -1) {
          content.sections[section][updateIndex] = article;
        }
        break;
        
      case 'delete':
        content.sections[section] = content.sections[section].filter(a => a.id !== id);
        break;
        
      default:
        return createResponse({ error: 'Invalid action' }, 400);
    }
    
    saveContent(content);
    return createResponse({ success: true, content });
    
  } catch (err) {
    return createResponse({ error: err.message }, 500);
  }
}

function getContent() {
  const stored = PropertiesService.getScriptProperties().getProperty(CONTENT_KEY);
  
  if (!stored) {
    return {
      sections: {
        home: [],
        about: [],
        projects: [],
        contact: []
      }
    };
  }
  
  return JSON.parse(stored);
}

function saveContent(content) {
  PropertiesService.getScriptProperties().setProperty(CONTENT_KEY, JSON.stringify(content));
}

function extractToken(e) {
  const authHeader = e.parameter.authorization || e.parameters.authorization;
  if (authHeader && authHeader[0]) {
    return authHeader[0].replace('Bearer ', '');
  }
  return null;
}

function createResponse(data, status = 200) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function doOptions(e) {
  return ContentService.createTextOutput('')
    .setMimeType(ContentService.MimeType.TEXT)
    .setHeaders({
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });
}
