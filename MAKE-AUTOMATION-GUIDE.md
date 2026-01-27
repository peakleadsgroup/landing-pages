# Make.com Automation Guide
## Peak Leads Group - Article Publishing Automation

**Last Updated:** January 17, 2025  
**Purpose:** Complete guide for setting up Make.com automations to publish articles from Airtable

---

## 📋 Overview

You'll need **2 Make.com scenarios**:

1. **Main Scenario:** Publish/Update Article (runs when article status changes to "Published")
2. **Update Recent Articles Scenario:** Updates "Most Recent Articles" section on all article pages

---

## 🔄 Scenario 1: Publish/Update Article

### **Trigger: Airtable - Watch Records**

**Module:** Airtable > Watch Records

**Settings:**
- **Base:** Select your "Peak Leads Articles" base
- **Table:** Articles
- **Trigger:** When a record matches conditions
- **Conditions:**
  - `Status` equals `Published`
- **Limit:** 1

**Why:** Triggers when an article is published or updated to Published status

---

### **Action 1: Airtable - Get a Record**

**Module:** Airtable > Get a Record

**Settings:**
- **Base:** Same base
- **Table:** Articles
- **Record ID:** `{{trigger.recordId}}`

**Why:** Gets the full article record with all fields

---

### **Action 2: Set Variables (for easier reference)**

**Module:** Set Variables (or use Data Store)

**Variables to set:**
```
articleTitle = {{1.Title}}
articleSlug = {{1.URL Slug}}
metaDescription = {{1.Meta Description}}
primaryKeyword = {{1.Primary Keyword}}
content = {{1.Content}}
excerpt = {{1.Excerpt}}
featuredImage = {{1.Featured Image URL}}
altText = {{1.Alt Text}}
publishedDate = {{1.Published Date}}
modifiedDate = {{1.Modified Date}}
canonicalURL = {{1.Canonical URL}}
authorName = {{1.Author}} (from lookup)
internalLinks = {{1.Internal Links}}
```

**Why:** Makes it easier to reference values in later modules

---

### **Action 3: Format Dates to ISO 8601**

**Module:** Text Parser > Replace

**For Published Date:**
- **Text:** `{{publishedDate}}`
- **Find:** Various date formats (handle conversion)
- **Replace:** ISO 8601 format

**OR use a Code module (JavaScript):**
```javascript
// Convert Airtable date to ISO 8601
const publishedDate = new Date(input.publishedDate);
const isoDate = publishedDate.toISOString();
return {isoDate};
```

**Repeat for Modified Date**

**Why:** Schema requires ISO 8601 format dates

---

### **Action 4: Generate ArticleSchema JSON**

**Module:** Code (JavaScript)

**Code:**
```javascript
const schema = {
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": input.articleTitle,
  "description": input.metaDescription,
  "image": input.featuredImage,
  "datePublished": input.publishedDateISO,
  "dateModified": input.modifiedDateISO,
  "author": {
    "@type": "Organization",
    "name": input.authorName
  },
  "publisher": {
    "@type": "Organization",
    "name": "Peak Leads Group",
    "alternateName": "Peak Leads Marketing Group",
    "logo": {
      "@type": "ImageObject",
      "url": "https://peakleadsgroup.com/Images/Peak%20Leads%20Flattened%20Logo.png"
    }
  },
  "mainEntityOfPage": {
    "@type": "WebPage",
    "@id": input.canonicalURL
  }
};

return {
  schemaJSON: JSON.stringify(schema, null, 2)
};
```

**Why:** Generates the ArticleSchema JSON-LD for SEO

---

### **Action 5: Format Published Date for Display**

**Module:** Text Parser or Code

**Convert ISO date to readable format:** "January 17, 2025"

**Code example:**
```javascript
const date = new Date(input.publishedDateISO);
const options = { year: 'numeric', month: 'long', day: 'numeric' };
return { formattedDate: date.toLocaleDateString('en-US', options) };
```

**Why:** For display in article header

---

### **Action 6: Read Article Template**

**Module:** HTTP > Make a Request

**Settings:**
- **Method:** GET
- **URL:** `https://raw.githubusercontent.com/peakleadsgroup/landing-pages/main/articles/ARTICLE-TEMPLATE.html`
- **OR:** Use File Storage module if you have the template stored

**Why:** Gets the HTML template to populate

---

### **Action 7: Replace Template Placeholders**

**Module:** Text Parser > Replace (multiple times)

**Replacements needed:**

1. `[ARTICLE_TITLE]` → `{{articleTitle}}`
2. `[ARTICLE_SLUG]` → `{{articleSlug}}`
3. `[META_DESCRIPTION]` → `{{metaDescription}}`
4. `[FEATURED_IMAGE_URL]` → `{{featuredImage}}`
5. `[ALT_TEXT]` → `{{altText}}`
6. `[PUBLISHED_DATE]` → `{{formattedDate}}`
7. `[PUBLISHED_DATE_ISO]` → `{{publishedDateISO}}`
8. `[MODIFIED_DATE_ISO]` → `{{modifiedDateISO}}`
9. `[AUTHOR_NAME]` → `{{authorName}}`
10. `[ARTICLE_CONTENT_HTML]` → `{{content}}`
11. `[ARTICLE_SLUG]` (in URLs) → `{{articleSlug}}`

**OR use a single Code module:**
```javascript
let html = input.templateHTML;

// Replace all placeholders
html = html.replace(/\[ARTICLE_TITLE\]/g, input.articleTitle);
html = html.replace(/\[ARTICLE_SLUG\]/g, input.articleSlug);
html = html.replace(/\[META_DESCRIPTION\]/g, input.metaDescription);
html = html.replace(/\[FEATURED_IMAGE_URL\]/g, input.featuredImage);
html = html.replace(/\[ALT_TEXT\]/g, input.altText);
html = html.replace(/\[PUBLISHED_DATE\]/g, input.formattedDate);
html = html.replace(/\[PUBLISHED_DATE_ISO\]/g, input.publishedDateISO);
html = html.replace(/\[MODIFIED_DATE_ISO\]/g, input.modifiedDateISO);
html = html.replace(/\[AUTHOR_NAME\]/g, input.authorName);
html = html.replace(/\[ARTICLE_CONTENT_HTML\]/g, input.content);

return { populatedHTML: html };
```

**Why:** Populates the template with actual article data

---

### **Action 8: Save Article HTML File**

**Module:** GitHub > Create Content (or your hosting method)

**Settings:**
- **Repository:** `peakleadsgroup/landing-pages`
- **Path:** `articles/{{articleSlug}}.html`
- **Content:** `{{populatedHTML}}`
- **Commit message:** `Add article: {{articleTitle}}`
- **Branch:** `main` (or your default branch)

**OR if using FTP/SSH:**
- **Module:** FTP > Upload a File
- **Path:** `/articles/{{articleSlug}}.html`
- **Content:** `{{populatedHTML}}`

**Why:** Creates the actual article HTML file

---

### **Action 9: Get Most Recent 3 Articles (for Recent Articles section)**

**Module:** Airtable > Search Records

**Settings:**
- **Base:** Same base
- **Table:** Articles
- **Filter:**
  - `Status` equals `Published`
  - `Record ID` does not equal `{{trigger.recordId}}` (exclude current article)
- **Sort:** Published Date (Descending)
- **Limit:** 3

**Why:** Gets the 3 most recent articles (excluding current) for the "Most Recent Articles" section

---

### **Action 10: Build Recent Articles HTML**

**Module:** Code (JavaScript)

**Code:**
```javascript
const recentArticles = input.recentArticles;
let html = '';

recentArticles.forEach(article => {
  html += `
    <div class="recent-card">
      <h3><a href="articles/${article['URL Slug']}.html">${article.Title}</a></h3>
      <p>${article.Excerpt}</p>
    </div>
  `;
});

return { recentArticlesHTML: html };
```

**Why:** Generates HTML for the "Most Recent Articles" section

---

### **Action 11: Update Article HTML with Recent Articles**

**Module:** Text Parser > Replace

**Find:** `<!-- Most recent 3 articles (excluding current article) will be auto-inserted here -->` and everything until `</div>` closing tag

**Replace:** The `{{recentArticlesHTML}}` generated in previous step

**OR:** Use Code module to insert into the `#recentArticlesGrid` div

**Why:** Adds the recent articles section to the article page

---

### **Action 12: Re-save Article HTML (with Recent Articles)**

**Module:** GitHub > Update Content (or FTP)

**Same as Action 8, but update the file**

**Why:** Saves the article with populated Recent Articles section

---

### **Action 13: Read Articles Listing Page**

**Module:** HTTP > Make a Request or GitHub > Get Content

**URL/Path:** `articles/index.html`

**Why:** Gets the current listing page to add new article

---

### **Action 14: Build Article Card HTML**

**Module:** Code (JavaScript)

**Code:**
```javascript
const article = input.article;

const articleCard = `
  <article class="article-card">
    <img src="${article['Featured Image URL']}" alt="${article['Alt Text']}" class="article-image">
    <div class="article-content">
      <div class="article-date">${formatDate(article['Published Date'])}</div>
      <h2 class="article-title">
        <a href="articles/${article['URL Slug']}.html">${article.Title}</a>
      </h2>
      <p class="article-excerpt">${article.Excerpt}</p>
      <a href="articles/${article['URL Slug']}.html" class="article-read-more">Read More →</a>
    </div>
  </article>
`;

return { articleCardHTML: articleCard };
```

**Why:** Creates the article card HTML for the listing page

---

### **Action 15: Insert Article Card into Listing Page**

**Module:** Text Parser > Replace

**Find:** `<div class="no-articles">` section (if it exists)

**OR:** Find `</div>` closing tag of `#articlesGrid` div

**Replace:** Insert `{{articleCardHTML}}` before the closing tag

**Why:** Adds the new article to the listing page

---

### **Action 16: Save Updated Listing Page**

**Module:** GitHub > Update Content

**Path:** `articles/index.html`
**Content:** Updated HTML

**Why:** Saves the updated listing page

---

### **Action 17: Update Homepage (if in top 3)**

**Module:** Airtable > Search Records

**Settings:**
- Filter: `Status` equals `Published`
- Sort: Published Date (Descending)
- Limit: 3

**Check:** If current article is in top 3

**If yes:**
- Read `index.html`
- Find `#articlesPreviewGrid`
- Build preview cards for top 3
- Replace the grid content
- Save updated homepage

**Why:** Updates homepage "Latest Articles" section

---

### **Action 18: Read Sitemap**

**Module:** HTTP > Make a Request or GitHub > Get Content

**Path:** `sitemap.xml`

**Why:** Gets current sitemap to add new article

---

### **Action 19: Add Article to Sitemap**

**Module:** Text Parser > Replace

**Find:** `</urlset>` (before closing tag)

**Replace with:**
```xml
  <url>
    <loc>https://peakleadsgroup.com/articles/{{articleSlug}}.html</loc>
    <lastmod>{{today's date in YYYY-MM-DD}}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>
</urlset>
```

**Why:** Adds article to sitemap for SEO

---

### **Action 20: Save Updated Sitemap**

**Module:** GitHub > Update Content

**Path:** `sitemap.xml`
**Content:** Updated sitemap

**Why:** Saves updated sitemap

---

## 🔄 Scenario 2: Update All Recent Articles Sections

**Purpose:** When a new article is published, update the "Most Recent Articles" section on ALL existing article pages.

### **Trigger: Airtable - Watch Records**

Same as Scenario 1 - triggers when Status = "Published"

---

### **Action 1: Get All Published Articles**

**Module:** Airtable > List Records

**Settings:**
- Filter: `Status` equals `Published`
- Sort: Published Date (Descending)
- Limit: 100 (or all)

**Why:** Gets all published articles

---

### **Action 2: For Each Article, Update Recent Articles**

**Module:** Iterator > For Each

**For each article:**

1. **Get Most Recent 3** (excluding current)
2. **Read article HTML file**
3. **Replace Recent Articles section**
4. **Save updated file**

**Why:** Updates Recent Articles on all pages

---

## 🎯 Simplified Alternative Approach

If the above seems complex, here's a simpler approach:

### **Single Scenario: Publish Article**

1. **Trigger:** Airtable record updated to Published
2. **Get article data**
3. **Generate Schema JSON**
4. **Read template**
5. **Replace placeholders** (leave Recent Articles empty for now)
6. **Save article file**
7. **Add to listing page**
8. **Add to sitemap**
9. **Trigger Scenario 2** (update all recent articles)

---

## 📝 Key Make.com Modules You'll Need

1. **Airtable** - Watch Records, Get Record, Search Records, List Records
2. **Code** - JavaScript for data manipulation
3. **Text Parser** - Replace text/placeholders
4. **HTTP** - Make requests (for GitHub API or file retrieval)
5. **GitHub** - Create/Update Content (if using GitHub)
6. **FTP/SSH** - Upload files (if using direct hosting)

---

## 🔧 Important Notes

### **Date Formatting:**
- Airtable dates need conversion to ISO 8601 for schema
- Also need readable format for display

### **HTML Escaping:**
- Make sure to escape HTML in content if needed
- Use `htmlEscape()` function in Code module

### **Error Handling:**
- Add error handlers for each critical step
- Log errors for debugging

### **Rate Limits:**
- GitHub API has rate limits
- Consider batching updates if publishing multiple articles

### **Testing:**
- Test with Status = "Draft" first
- Use a test branch before pushing to main
- Verify HTML output before publishing

---

## 🚀 Quick Start Checklist

- [ ] Create Make.com account
- [ ] Connect Airtable base
- [ ] Connect GitHub repository (or hosting method)
- [ ] Create Scenario 1: Publish Article
- [ ] Test with one article (Status = Draft first)
- [ ] Verify HTML output
- [ ] Test publishing workflow
- [ ] Create Scenario 2: Update Recent Articles (optional, can be manual for now)
- [ ] Set up error notifications
- [ ] Document any customizations

---

## 📞 Next Steps

1. **Set up the basic scenario** (Actions 1-8) to create article files
2. **Test with one article**
3. **Add listing page updates** (Actions 13-16)
4. **Add sitemap updates** (Actions 18-20)
5. **Add Recent Articles updates** (can be manual initially)

---

**Need help with a specific step?** Let me know which part you'd like me to detail further!

