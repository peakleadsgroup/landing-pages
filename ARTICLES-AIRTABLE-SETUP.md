# Articles Airtable Setup Guide
## Peak Leads Group - Article Automation Structure

**Last Updated:** January 17, 2025  
**Purpose:** Complete guide for setting up Airtable to automate article publishing with optimal SEO

---

## 📋 Airtable Base Structure

### Table Name: `Articles`

Create a single table called "Articles" with the following fields:

---

## 🔤 Required Fields

### **1. Title** (Single line text)
- **Field Name:** `Title`
- **Type:** Single line text
- **Required:** Yes
- **Description:** Article headline - will be used for H1, title tag, and ArticleSchema headline
- **Example:** "How to Qualify Home Service Leads Before They Call"
- **SEO Impact:** HIGH - Used in H1, title tag, and schema markup

---

### **2. URL Slug** (Single line text)
- **Field Name:** `URL Slug`
- **Type:** Single line text
- **Required:** Yes
- **Description:** URL-friendly version of title (lowercase, hyphens, no special chars)
- **Formatting Rules:**
  - Lowercase only
  - Use hyphens instead of spaces
  - No special characters
  - Keep under 60 characters
- **Example:** "how-to-qualify-home-service-leads"
- **Auto-Generate:** Can use formula: `LOWER(SUBSTITUTE(Title, " ", "-"))` (then manually clean)
- **SEO Impact:** HIGH - Used in URL and canonical tag

---

### **3. Meta Description** (Long text)
- **Field Name:** `Meta Description`
- **Type:** Long text
- **Required:** Yes
- **Max Length:** 160 characters (recommended: 150-160)
- **Description:** SEO meta description - appears in search results
- **Best Practices:**
  - Include primary keyword
  - Compelling call-to-action
  - 150-160 characters
- **Example:** "Learn proven strategies to qualify home service leads before they call. Increase your conversion rate with these expert tips from Peak Leads Group."
- **SEO Impact:** HIGH - Affects click-through rate from search results

---

### **4. Primary Keyword** (Single line text)
- **Field Name:** `Primary Keyword`
- **Type:** Single line text
- **Required:** Yes
- **Description:** Main SEO keyword for this article
- **Example:** "qualify home service leads"
- **SEO Impact:** HIGH - Used in headings, meta tags, and content optimization

---

### **5. Content** (Long text / Rich text)
- **Field Name:** `Content`
- **Type:** Long text (or Rich text if Airtable supports HTML)
- **Required:** Yes
- **Description:** Full article HTML content
- **Formatting:**
  - Use proper HTML tags (H2, H3, P, UL, OL, etc.)
  - Include internal links with anchor text
  - Add images with alt text
- **Example:** `<h2>Section Heading</h2><p>Content paragraph...</p>`
- **SEO Impact:** HIGH - Main content for SEO

---

### **6. Excerpt** (Long text)
- **Field Name:** `Excerpt`
- **Type:** Long text
- **Required:** Yes
- **Max Length:** 200 characters (recommended: 150-200)
- **Description:** Short summary for article listing pages
- **Example:** "Discover proven strategies to qualify leads before they call, increasing your conversion rate and reducing wasted time."
- **SEO Impact:** MEDIUM - Used in listing pages and social sharing

---

### **7. Featured Image URL** (URL)
- **Field Name:** `Featured Image URL`
- **Type:** URL
- **Required:** Yes
- **Description:** Main article image URL (hosted on your server/CDN)
- **Best Practices:**
  - Use absolute URLs
  - Optimize images (WebP format recommended)
  - Recommended size: 1200x630px for social sharing
- **Example:** `https://peakleadsgroup.com/Images/articles/article-image.jpg`
- **SEO Impact:** HIGH - Used in ArticleSchema, OG tags, and Twitter cards

---

### **8. Alt Text** (Single line text)
- **Field Name:** `Alt Text`
- **Type:** Single line text
- **Required:** Yes
- **Description:** Alt text for featured image (accessibility + SEO)
- **Best Practices:**
  - Descriptive and keyword-rich
  - Under 125 characters
- **Example:** "Home service professional qualifying leads over phone"
- **SEO Impact:** MEDIUM - Important for image SEO and accessibility

---

### **9. Published Date** (Date)
- **Field Name:** `Published Date`
- **Type:** Date (with time)
- **Required:** Yes
- **Description:** Publication date (ISO 8601 format for schema)
- **Format:** YYYY-MM-DDTHH:MM:SS+00:00
- **Example:** `2025-01-17T00:00:00+00:00`
- **SEO Impact:** HIGH - Used in ArticleSchema datePublished

---

### **10. Modified Date** (Date)
- **Field Name:** `Modified Date`
- **Type:** Date (with time)
- **Required:** Yes
- **Description:** Last modification date (ISO 8601 format)
- **Format:** YYYY-MM-DDTHH:MM:SS+00:00
- **Default:** Same as Published Date (update when editing)
- **Example:** `2025-01-17T00:00:00+00:00`
- **SEO Impact:** HIGH - Used in ArticleSchema dateModified

---

### **11. Status** (Single select)
- **Field Name:** `Status`
- **Type:** Single select
- **Required:** Yes
- **Options:**
  - `Draft` (not published)
  - `Published` (live on site)
- **Default:** Draft
- **SEO Impact:** LOW - Used for filtering/automation

---

### **12. Canonical URL** (Single line text)
- **Field Name:** `Canonical URL`
- **Type:** Single line text
- **Required:** Yes
- **Description:** Full canonical URL for the article
- **Formula:** `"https://peakleadsgroup.com/articles/" & {URL Slug} & ".html"`
- **Example:** `https://peakleadsgroup.com/articles/how-to-qualify-leads.html`
- **SEO Impact:** HIGH - Prevents duplicate content issues

---

### **13. Staff** (Link to another table)
- **Field Name:** `Staff`
- **Type:** Link to another table
- **Required:** Yes
- **Description:** Link to Staff table to select author
- **Note:** Create a "Staff" table with fields: Name, Email, etc.
- **SEO Impact:** MEDIUM - Used for author attribution

---

### **14. Author** (Lookup field)
- **Field Name:** `Author`
- **Type:** Lookup (from Staff field)
- **Required:** Yes
- **Description:** Auto-populates author name from linked Staff record
- **Formula:** Lookup from Staff → Name field
- **SEO Impact:** MEDIUM - Used in ArticleSchema author

---

### **15. Internal Links** (Long text)
- **Field Name:** `Internal Links`
- **Type:** Long text
- **Required:** No
- **Description:** Comma-separated list of internal URLs to link to in content
- **Format:** `"/About.html, /HowWeDoIt.html, /WhoWeServe.html"`
- **Example:** `/About.html, /HowWeDoIt.html`
- **SEO Impact:** MEDIUM - Internal linking structure

---

### **16. Schema JSON** (Long text)
- **Field Name:** `Schema JSON`
- **Type:** Long text
- **Required:** No (can be auto-generated)
- **Description:** Pre-generated ArticleSchema JSON-LD structured data
- **What it does:** 
  - Tells search engines (Google, Bing, etc.) what your article is about
  - Enables rich results in search (article carousels, featured snippets)
  - Helps Google understand your content better
  - Can show publication date, author, and other metadata in search results
- **Format:** JSON-LD (JavaScript Object Notation for Linked Data)
- **Can be auto-generated** by automation tool from other Airtable fields
- **Example:** Contains article title, description, dates, author, image, etc. in structured format
- **SEO Impact:** HIGH - Critical for search engine optimization and rich results

---

## 🔄 Field Mapping for Automation

When creating an article HTML file from Airtable, map fields as follows:

| Airtable Field | → | HTML Element / Location |
|---------------|---|------------------------|
| Title | → | `<h1>`, `<title>`, ArticleSchema.headline |
| URL Slug | → | Filename: `[slug].html` |
| Meta Description | → | `<meta name="description">`, ArticleSchema.description |
| Primary Keyword | → | Used in headings and content optimization |
| Content | → | Main article body (`.article-body`) |
| Excerpt | → | Article listing pages, social sharing |
| Featured Image URL | → | ArticleSchema.image, OG image, featured image |
| Alt Text | → | Featured image `alt` attribute |
| Published Date | → | ArticleSchema.datePublished, OG article:published_time |
| Modified Date | → | ArticleSchema.dateModified |
| Canonical URL | → | `<link rel="canonical">` |
| Author (from Staff lookup) | → | ArticleSchema.author.name |
| Featured Image URL | → | OG image (used for social sharing) |
| Internal Links | → | Contextual links in content |
| Most Recent Articles | → | Auto-populated from last 3 published articles (excluding current) |

---

## 📝 Example Airtable Record

Here's what a complete article record should look like:

```
Title: "How to Qualify Home Service Leads Before They Call"
URL Slug: "how-to-qualify-home-service-leads"
Meta Description: "Learn proven strategies to qualify home service leads before they call. Increase your conversion rate with these expert tips from Peak Leads Group."
Primary Keyword: "qualify home service leads"
Content: "<h2>Understanding Lead Qualification</h2><p>Qualifying leads is crucial...</p>"
Excerpt: "Discover proven strategies to qualify leads before they call, increasing your conversion rate and reducing wasted time."
Featured Image URL: "https://peakleadsgroup.com/Images/articles/qualify-leads.jpg"
Alt Text: "Home service professional qualifying leads over phone"
Published Date: "2025-01-17T00:00:00+00:00"
Modified Date: "2025-01-17T00:00:00+00:00"
Status: "Published"
Canonical URL: "https://peakleadsgroup.com/articles/how-to-qualify-home-service-leads.html"
Staff: [Link to Staff record]
Author: "Daniel Wellish" (auto-populated from Staff lookup)
Internal Links: "/About.html, /HowWeDoIt.html"
Schema JSON: "{...}" (auto-generated)
Most Recent Articles: [Auto-populated - last 3 published articles excluding current]
```

---

## 🤖 Automation Workflow (Make.com / Zapier)

### **Trigger:**
- **When:** New record created in Airtable
- **Filter:** Status = "Published"

### **Actions:**

1. **Generate ArticleSchema JSON**
   - Use Airtable fields to build JSON-LD schema
   - Format dates to ISO 8601
   - Include all required fields

2. **Create HTML File**
   - Use `ARTICLE-TEMPLATE.html` as base
   - Replace all placeholders with Airtable field values:
     - `[ARTICLE_TITLE]` → Title
     - `[ARTICLE_SLUG]` → URL Slug
     - `[META_DESCRIPTION]` → Meta Description
     - `[FEATURED_IMAGE_URL]` → Featured Image URL
     - `[ALT_TEXT]` → Alt Text
     - `[PUBLISHED_DATE]` → Published Date (formatted)
     - `[MODIFIED_DATE]` → Modified Date (formatted)
     - `[PUBLISHED_DATE_ISO]` → Published Date (ISO format)
     - `[MODIFIED_DATE_ISO]` → Modified Date (ISO format)
     - `[AUTHOR_NAME]` → Author (from Staff lookup)
     - `[ARTICLE_CONTENT_HTML]` → Content
     - `[MOST_RECENT_ARTICLES]` → Last 3 published articles (excluding current article)

3. **Save File**
   - Filename: `[URL Slug].html`
   - Location: `/articles/` directory
   - Upload to GitHub/server

4. **Update Articles Listing Page**
   - Add article card to `/articles/index.html`
   - Insert into `#articlesGrid` div
   - Use article card HTML structure from template

5. **Update Homepage (Optional)**
   - Add to "Latest Articles" section if within top 3
   - Update `/index.html` `#articlesPreviewGrid`

6. **Update Most Recent Articles Section**
   - On each article page, populate "Most Recent Articles" with last 3 published articles
   - Exclude the current article from the list
   - Update `#recentArticlesGrid` div

7. **Update Sitemap**
   - Add new article URL to `sitemap.xml`
   - Format: `<url><loc>https://peakleadsgroup.com/articles/[slug].html</loc>...</url>`

---

## 🔍 SEO Checklist Per Article

Before publishing, ensure each article has:

- [ ] **URL Slug** includes primary keyword
- [ ] **Title** includes primary keyword (natural placement)
- [ ] **Meta Description** is 150-160 characters with keyword
- [ ] **Content** includes:
  - [ ] One H1 (article title)
  - [ ] Multiple H2 sections
  - [ ] H3 subsections where appropriate
  - [ ] Primary keyword in first paragraph
  - [ ] Primary keyword in 2-3 H2 headings
  - [ ] Semantic keywords throughout
  - [ ] 3-5 internal links to other pages/articles
  - [ ] Images with alt text
- [ ] **Featured Image** optimized and has alt text
- [ ] **ArticleSchema** includes all required fields
- [ ] **Canonical URL** set correctly
- [ ] **Published Date** and **Modified Date** in ISO format
- [ ] **Internal Links** added to content
- [ ] **Most Recent Articles** will auto-populate (last 3 published, excluding current)

---

## 📊 Airtable Views

### **Recommended Views:**

1. **Published Articles**
   - Filter: Status = "Published"
   - Sort: Published Date (descending)
   - Use for: Listing page updates

2. **Draft Articles**
   - Filter: Status = "Draft"
   - Sort: Modified Date (descending)
   - Use for: Content editing

3. **Recent Articles**
   - Filter: Status = "Published"
   - Sort: Published Date (descending)
   - Limit: 12 records
   - Use for: Homepage "Latest Articles" section

4. **All Articles**
   - No filter
   - Sort: Modified Date (descending)
   - Use for: General management

---

## 🚀 Next Steps

1. **Set up Airtable base** with all fields listed above
2. **Create automation** (Make.com or Zapier) to:
   - Generate ArticleSchema JSON
   - Create HTML files from template
   - Update listing pages
   - Update sitemap
3. **Test with 1-2 sample articles**
4. **Verify SEO elements** using:
   - Google Rich Results Test: https://search.google.com/test/rich-results
   - Schema.org Validator: https://validator.schema.org/
5. **Submit sitemap** to Google Search Console

---

## 📞 Support

For questions about this setup, refer to:
- Article Template: `/articles/ARTICLE-TEMPLATE.html`
- Articles Listing: `/articles/index.html`
- SEO Documentation: `/SEOREADME.md`

---

**Document Maintained By:** SEO & Development Team  
**Last Review Date:** January 17, 2025

