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

### **13. Author Name** (Single line text)
- **Field Name:** `Author Name`
- **Type:** Single line text
- **Required:** Yes
- **Default:** "Peak Leads Group"
- **Description:** Article author name
- **SEO Impact:** MEDIUM - Used in ArticleSchema author

---

### **14. Author URL** (URL)
- **Field Name:** `Author URL`
- **Type:** URL
- **Required:** Yes
- **Default:** `https://peakleadsgroup.com`
- **Description:** Author/organization URL
- **SEO Impact:** MEDIUM - Used in ArticleSchema author

---

### **15. Open Graph Image URL** (URL)
- **Field Name:** `OG Image URL`
- **Type:** URL
- **Required:** No (optional)
- **Description:** Custom Open Graph image (defaults to Featured Image if empty)
- **Best Practices:**
  - 1200x630px recommended
  - Can be same as Featured Image
- **SEO Impact:** MEDIUM - Social sharing appearance

---

### **16. Related Articles** (Link to another table)
- **Field Name:** `Related Articles`
- **Type:** Link to another table (self-referencing)
- **Required:** No
- **Description:** Link to 3-5 related articles
- **Best Practices:**
  - Select articles with similar topics
  - Helps with internal linking
- **SEO Impact:** MEDIUM - Internal linking for SEO

---

### **17. Internal Links** (Long text)
- **Field Name:** `Internal Links`
- **Type:** Long text
- **Required:** No
- **Description:** Comma-separated list of internal URLs to link to in content
- **Format:** `"/About.html, /HowWeDoIt.html, /WhoWeServe.html"`
- **Example:** `/About.html, /HowWeDoIt.html`
- **SEO Impact:** MEDIUM - Internal linking structure

---

### **18. Reading Time** (Number)
- **Field Name:** `Reading Time`
- **Type:** Number
- **Required:** No
- **Description:** Estimated reading time in minutes
- **Formula:** Can calculate based on word count (average 200 words/minute)
- **Example:** `8` (for 8 minutes)
- **SEO Impact:** LOW - UX improvement

---

### **19. Category** (Single select)
- **Field Name:** `Category`
- **Type:** Single select
- **Required:** No (optional)
- **Options:**
  - Lead Generation Tips
  - Home Services Marketing
  - CRM & Integrations
  - Case Studies
  - Industry Insights
  - Sales & Conversion
- **SEO Impact:** LOW - Organization only (not used in current structure)

---

### **20. Schema JSON** (Long text)
- **Field Name:** `Schema JSON`
- **Type:** Long text
- **Required:** No (can be auto-generated)
- **Description:** Pre-generated ArticleSchema JSON-LD
- **Can be auto-generated** by automation tool from other fields
- **SEO Impact:** HIGH - Structured data for search engines

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
| Author Name | → | ArticleSchema.author.name |
| Author URL | → | ArticleSchema.author.url |
| OG Image URL | → | OG image (or Featured Image if empty) |
| Related Articles | → | Related articles section |
| Internal Links | → | Contextual links in content |

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
Author Name: "Peak Leads Group"
Author URL: "https://peakleadsgroup.com"
OG Image URL: "" (empty, will use Featured Image)
Related Articles: [Link to 3-5 related articles]
Internal Links: "/About.html, /HowWeDoIt.html"
Reading Time: 8
Category: "Lead Generation Tips"
Schema JSON: "{...}" (auto-generated)
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
     - `[AUTHOR_NAME]` → Author Name
     - `[AUTHOR_URL]` → Author URL
     - `[ARTICLE_CONTENT_HTML]` → Content
     - `[RELATED_ARTICLE_URL]` → Related Articles URLs
     - `[RELATED_ARTICLE_TITLE]` → Related Articles Titles
     - `[RELATED_ARTICLE_EXCERPT]` → Related Articles Excerpts

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

6. **Update Sitemap**
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
- [ ] **Related Articles** linked (3-5 articles)
- [ ] **Internal Links** added to content

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

