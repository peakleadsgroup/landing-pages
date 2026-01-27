# Make.com Step-by-Step: After Your Existing Setup

## ✅ What You Already Have:
1. ✅ Airtable webhook → Make.com
2. ✅ Get Record from Airtable

## 🎯 What You Need to Add Next:

---

## **Step 1: Format Dates to ISO 8601**

**Module:** Code (JavaScript)

**Inputs:**
- `publishedDate` = `{{Get Record.Published Date}}`
- `modifiedDate` = `{{Get Record.Modified Date}}`

**Code:**
```javascript
// Convert Airtable date to ISO 8601
function toISO(dateString) {
  if (!dateString) return new Date().toISOString();
  const date = new Date(dateString);
  return date.toISOString();
}

// Format for display (January 17, 2025)
function formatDisplayDate(dateString) {
  if (!dateString) return new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

return {
  publishedDateISO: toISO(input.publishedDate),
  modifiedDateISO: toISO(input.modifiedDate),
  publishedDateDisplay: formatDisplayDate(input.publishedDate)
};
```

**Outputs:**
- `publishedDateISO` - for schema
- `modifiedDateISO` - for schema
- `publishedDateDisplay` - for article header

---

## **Step 2: Generate ArticleSchema JSON**

**Module:** Code (JavaScript)

**Inputs:**
- `title` = `{{Get Record.Title}}`
- `metaDescription` = `{{Get Record.Meta Description}}`
- `featuredImage` = `{{Get Record.Featured Image URL}}`
- `publishedDateISO` = `{{Format Dates.publishedDateISO}}`
- `modifiedDateISO` = `{{Format Dates.modifiedDateISO}}`
- `authorName` = `{{Get Record.Author}}` (from lookup)
- `canonicalURL` = `{{Get Record.Canonical URL}}`

**Code:**
```javascript
const schema = {
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": input.title,
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

**Output:**
- `schemaJSON` - ready to insert into template

---

## **Step 3: Get Article Template**

**Module:** HTTP > Make a Request

**Method:** GET  
**URL:** `https://raw.githubusercontent.com/peakleadsgroup/landing-pages/main/articles/ARTICLE-TEMPLATE.html`

**Output:** Template HTML

---

## **Step 4: Replace All Placeholders in Template**

**Module:** Code (JavaScript)

**Inputs:**
- `template` = `{{Get Template.body}}` (or `{{Get Template.data}}` depending on HTTP response format)
- `title` = `{{Get Record.Title}}`
- `slug` = `{{Get Record.URL Slug}}`
- `metaDescription` = `{{Get Record.Meta Description}}`
- `featuredImage` = `{{Get Record.Featured Image URL}}`
- `altText` = `{{Get Record.Alt Text}}`
- `publishedDateDisplay` = `{{Format Dates.publishedDateDisplay}}`
- `publishedDateISO` = `{{Format Dates.publishedDateISO}}`
- `modifiedDateISO` = `{{Format Dates.modifiedDateISO}}`
- `authorName` = `{{Get Record.Author}}`
- `content` = `{{Get Record.Content}}`
- `schemaJSON` = `{{Generate Schema.schemaJSON}}`

**Code:**
```javascript
let html = input.template;

// Replace all placeholders
html = html.replace(/\[ARTICLE_TITLE\]/g, input.title || '');
html = html.replace(/\[ARTICLE_SLUG\]/g, input.slug || '');
html = html.replace(/\[META_DESCRIPTION\]/g, input.metaDescription || '');
html = html.replace(/\[FEATURED_IMAGE_URL\]/g, input.featuredImage || '');
html = html.replace(/\[ALT_TEXT\]/g, input.altText || '');
html = html.replace(/\[PUBLISHED_DATE\]/g, input.publishedDateDisplay || '');
html = html.replace(/\[PUBLISHED_DATE_ISO\]/g, input.publishedDateISO || '');
html = html.replace(/\[MODIFIED_DATE_ISO\]/g, input.modifiedDateISO || '');
html = html.replace(/\[AUTHOR_NAME\]/g, input.authorName || 'Peak Leads Group');
html = html.replace(/\[ARTICLE_CONTENT_HTML\]/g, input.content || '');

// Replace Schema JSON (find the script tag and replace content)
html = html.replace(
  /<script type="application\/ld\+json">[\s\S]*?<\/script>/,
  `<script type="application/ld+json">\n${input.schemaJSON}\n    </script>`
);

return { populatedHTML: html };
```

**Output:**
- `populatedHTML` - complete article HTML ready to save

---

## **Step 5: Get Most Recent 3 Articles (for Recent Articles section)**

**Module:** Airtable > Search Records

**Settings:**
- **Base:** Your Articles base
- **Table:** Articles
- **Filter Formula:** 
  ```
  AND(
    {Status} = "Published",
    RECORD_ID() != "{{Get Record.Record ID}}"
  )
  ```
- **Sort:** Published Date (Descending)
- **Limit:** 3

**Output:** Array of 3 most recent articles

---

## **Step 6: Build Recent Articles HTML**

**Module:** Code (JavaScript)

**Inputs:**
- `recentArticles` = `{{Search Records}}` (array)

**Code:**
```javascript
const articles = input.recentArticles || [];

if (articles.length === 0) {
  return { recentArticlesHTML: '<p>More articles coming soon!</p>' };
}

let html = '';
articles.forEach(article => {
  const slug = article.fields['URL Slug'] || article['URL Slug'];
  const title = article.fields.Title || article.Title;
  const excerpt = article.fields.Excerpt || article.Excerpt;
  
  html += `
                    <div class="recent-card">
                        <h3><a href="articles/${slug}.html">${title}</a></h3>
                        <p>${excerpt || ''}</p>
                    </div>
                    `;
});

return { recentArticlesHTML: html };
```

**Output:**
- `recentArticlesHTML` - HTML for recent articles section

---

## **Step 7: Insert Recent Articles into Article HTML**

**Module:** Code (JavaScript)

**Inputs:**
- `articleHTML` = `{{Replace Placeholders.populatedHTML}}`
- `recentArticlesHTML` = `{{Build Recent Articles.recentArticlesHTML}}`

**Code:**
```javascript
let html = input.articleHTML;

// Find the recent articles grid and replace content
// Look for the div with id="recentArticlesGrid"
const gridPattern = /<div class="recent-grid" id="recentArticlesGrid">[\s\S]*?<\/div>\s*<\/div>/;

const replacement = `<div class="recent-grid" id="recentArticlesGrid">
                    ${input.recentArticlesHTML}
                </div>`;

html = html.replace(gridPattern, replacement);

return { finalHTML: html };
```

**Output:**
- `finalHTML` - complete article with Recent Articles populated

---

## **Step 8: Create Article File via GitHub API**

**Module:** HTTP > Make a Request

**Method:** PUT  
**URL:** `https://api.github.com/repos/peakleadsgroup/landing-pages/contents/articles/{{Get Record.URL Slug}}.html`

**Headers:**
```
Authorization: Bearer YOUR_GITHUB_TOKEN
Accept: application/vnd.github.v3+json
```

**Body (JSON):**
```json
{
  "message": "Add article: {{Get Record.Title}}",
  "content": "{{Base64 encode finalHTML}}",
  "branch": "main"
}
```

**Note:** You'll need to base64 encode the HTML. Add a Code module before this:

**Module:** Code (JavaScript) - Base64 Encode
```javascript
const html = input.finalHTML;
const base64 = Buffer.from(html).toString('base64');
return { base64Content: base64 };
```

Then use `{{Base64 Encode.base64Content}}` in the content field.

---

## **Step 9: Read Articles Listing Page**

**Module:** HTTP > Make a Request

**Method:** GET  
**URL:** `https://raw.githubusercontent.com/peakleadsgroup/landing-pages/main/articles/index.html`

**Output:** Current listing page HTML

---

## **Step 10: Build Article Card HTML**

**Module:** Code (JavaScript)

**Inputs:**
- `title` = `{{Get Record.Title}}`
- `slug` = `{{Get Record.URL Slug}}`
- `excerpt` = `{{Get Record.Excerpt}}`
- `featuredImage` = `{{Get Record.Featured Image URL}}`
- `altText` = `{{Get Record.Alt Text}}`
- `publishedDateDisplay` = `{{Format Dates.publishedDateDisplay}}`

**Code:**
```javascript
const articleCard = `
                <article class="article-card">
                    <img src="${input.featuredImage}" alt="${input.altText}" class="article-image">
                    <div class="article-content">
                        <div class="article-date">${input.publishedDateDisplay}</div>
                        <h2 class="article-title">
                            <a href="articles/${input.slug}.html">${input.title}</a>
                        </h2>
                        <p class="article-excerpt">${input.excerpt}</p>
                        <a href="articles/${input.slug}.html" class="article-read-more">Read More →</a>
                    </div>
                </article>
                `;

return { articleCardHTML: articleCard };
```

**Output:**
- `articleCardHTML` - HTML for article card

---

## **Step 11: Insert Article Card into Listing Page**

**Module:** Code (JavaScript)

**Inputs:**
- `listingHTML` = `{{Read Listing Page.body}}`
- `articleCard` = `{{Build Article Card.articleCardHTML}}`

**Code:**
```javascript
let html = input.listingHTML;

// Remove "no articles" message if it exists
html = html.replace(/<div class="no-articles">[\s\S]*?<\/div>/g, '');

// Find the articles grid and insert at the beginning
const gridPattern = /(<div class="articles-grid" id="articlesGrid">)/;
html = html.replace(gridPattern, `$1\n                ${input.articleCard}`);

return { updatedListingHTML: html };
```

**Output:**
- `updatedListingHTML` - listing page with new article added

---

## **Step 12: Update Listing Page via GitHub API**

**Module:** HTTP > Make a Request

**Method:** GET (first to get current file SHA)  
**URL:** `https://api.github.com/repos/peakleadsgroup/landing-pages/contents/articles/index.html`

Then:

**Method:** PUT  
**URL:** `https://api.github.com/repos/peakleadsgroup/landing-pages/contents/articles/index.html`

**Headers:**
```
Authorization: Bearer YOUR_GITHUB_TOKEN
Accept: application/vnd.github.v3+json
```

**Body (JSON):**
```json
{
  "message": "Add article to listing: {{Get Record.Title}}",
  "content": "{{Base64 encode updatedListingHTML}}",
  "sha": "{{GET_FILE_SHA}}",
  "branch": "main"
}
```

---

## **Step 13: Read Sitemap**

**Module:** HTTP > Make a Request

**Method:** GET  
**URL:** `https://raw.githubusercontent.com/peakleadsgroup/landing-pages/main/sitemap.xml`

---

## **Step 14: Add Article to Sitemap**

**Module:** Code (JavaScript)

**Inputs:**
- `sitemap` = `{{Read Sitemap.body}}`
- `slug` = `{{Get Record.URL Slug}}`
- `today` = Current date in YYYY-MM-DD format

**Code:**
```javascript
const today = new Date().toISOString().split('T')[0];
const newEntry = `  <url>
    <loc>https://peakleadsgroup.com/articles/${input.slug}.html</loc>
    <lastmod>${today}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>
</urlset>`;

const updatedSitemap = input.sitemap.replace('</urlset>', newEntry);

return { updatedSitemap: updatedSitemap };
```

**Output:**
- `updatedSitemap` - sitemap with new article

---

## **Step 15: Update Sitemap via GitHub API**

**Module:** HTTP > Make a Request

**Method:** GET (to get SHA) then PUT  
**URL:** `https://api.github.com/repos/peakleadsgroup/landing-pages/contents/sitemap.xml`

**Body:** Same format as Step 12, with base64 encoded sitemap

---

## 📋 Quick Module Flow Summary

```
1. [EXISTING] Airtable Webhook
2. [EXISTING] Get Record
3. Format Dates (Code)
4. Generate Schema JSON (Code)
5. Get Template (HTTP GET)
6. Replace Placeholders (Code)
7. Get Recent Articles (Airtable Search)
8. Build Recent Articles HTML (Code)
9. Insert Recent Articles (Code)
10. Base64 Encode Article (Code)
11. Create Article File (HTTP PUT to GitHub)
12. Read Listing Page (HTTP GET)
13. Build Article Card (Code)
14. Insert Article Card (Code)
15. Base64 Encode Listing (Code)
16. Update Listing Page (HTTP PUT to GitHub)
17. Read Sitemap (HTTP GET)
18. Add to Sitemap (Code)
19. Base64 Encode Sitemap (Code)
20. Update Sitemap (HTTP PUT to GitHub)
```

---

## 🔑 Important Notes

1. **GitHub Token:** You'll need a GitHub Personal Access Token with `repo` permissions
2. **Base64 Encoding:** GitHub API requires base64 encoded content
3. **File SHA:** When updating files, you need the current file's SHA (get it with a GET request first)
4. **Error Handling:** Add error handlers after critical steps
5. **Testing:** Test with a draft article first, or use a test branch

---

## 🚀 Start Simple

If this feels like a lot, start with just Steps 1-8 (create the article file), then add the listing and sitemap updates later!

Let me know if you need help with any specific step or module configuration!

