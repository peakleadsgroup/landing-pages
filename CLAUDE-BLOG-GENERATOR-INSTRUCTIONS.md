# Claude Blog Post Generator - Instructions
## Peak Leads Group Article Generation Project

**Purpose:** Generate SEO-optimized, natural, readable article content text for Peak Leads Group

---

## 🎯 Project Goal

Generate article content that is:
- ✅ **SEO-optimized** (proper structure, keywords, natural optimization)
- ✅ **Natural and readable** (not keyword-stuffed or spammy)
- ✅ **Well-structured** (proper HTML headings, formatting, internal links)
- ✅ **Ready for Airtable** (content text with HTML tags that will be inserted into template)

---

## 📋 What You'll Receive

1. **Sitemap file** - Shows site structure and existing pages
2. **Article template** - HTML structure (for reference only - you generate content only)
3. **Existing content examples** - For tone and style reference
4. **SEO guidelines** - Best practices without over-optimization
5. **Brand guidelines** - Company voice and messaging

---

## 📝 Article Generation Process

### **Step 1: Topic & Requirements**

When generating an article, I'll provide:
- **Topic/Title:** The main subject of the article
- **Target Audience:** Who it's for (e.g., home service business owners, marketing managers)
- **Primary Keyword:** Main SEO keyword to target
- **Secondary Keywords:** 2-3 related keywords to naturally include
- **Word Count:** Target length (typically 1,500-2,500 words)
- **Internal Links:** Which pages to link to (from sitemap)

### **Step 2: Content Generation Guidelines**

**Write naturally and conversationally:**
- Write like you're explaining to a colleague, not a robot
- Use "you" and "we" naturally
- Include real examples and practical advice
- Break up text with short paragraphs (2-4 sentences)
- Use bullet points and lists when helpful

**SEO without being spammy:**
- Include primary keyword in:
  - H1 (title) - naturally
  - First paragraph - once, naturally
  - 2-3 H2 headings - where it makes sense
  - Meta description - once
- Use semantic keywords (related terms) throughout
- Don't repeat the same keyword phrase multiple times in a row
- Vary your language - use synonyms and related terms

**Structure:**
- Start with intro paragraph (3-4 sentences, includes primary keyword once)
- 4-6 H2 sections (main topics) with detailed content
- H3 subsections where needed for organization
- Conclusion paragraph (2-3 sentences summarizing key points)
- Internal links naturally placed (3-5 links using HTML anchor tags)

**Note:** You're generating the CONTENT TEXT ONLY that goes into the "Content" field in Airtable. This content will be inserted into the article template automatically. Use HTML tags for headings (H2, H3), paragraphs (P), lists (UL, LI), and links (A), but do NOT include the full HTML page structure, meta tags, or template elements.

---

## ✍️ Content Writing Guidelines

### **Tone & Style**

- **Professional but approachable** - Not overly formal, but authoritative
- **Practical and actionable** - Give real advice readers can use
- **Conversational** - Write like you're talking to a peer
- **Confident** - Show expertise without being arrogant
- **Helpful** - Focus on solving problems for the reader

### **SEO Best Practices (Natural)**

**Primary Keyword Usage:**
- ✅ First paragraph - once, naturally in context
- ✅ 2-3 H2 headings - where it makes sense
- ❌ Don't stuff it everywhere
- ❌ Don't repeat it multiple times in a row

**Semantic Keywords:**
- Use related terms and synonyms
- Include LSI (Latent Semantic Indexing) keywords
- Vary your language naturally

**Internal Linking:**
- Link to 3-5 relevant pages naturally using HTML anchor tags
- Use descriptive anchor text (not "click here")
- Place links where they add value to the reader
- Link to: About, How We Do It, Who We Serve, Integrations, Contact, other articles
- Format links as: `<a href="/About.html">descriptive anchor text</a>`

**Heading Structure:**
```
Intro paragraph (3-4 sentences, includes primary keyword once)

<h2>Main Section 1</h2>
  <h3>Subsection (if needed)</h3>
<h2>Main Section 2</h2>
<h2>Main Section 3</h2>
<h2>Main Section 4</h2>

Conclusion paragraph (2-3 sentences)
```

**Note:** Use HTML tags for headings: `<h2>`, `<h3>`, `<p>`, `<ul>`, `<li>`, `<a>`, etc.

### **Content Quality**

**Do:**
- ✅ Write comprehensive, helpful content
- ✅ Use examples and real-world scenarios
- ✅ Break up text with headings, lists, and short paragraphs
- ✅ Include actionable takeaways
- ✅ Write for humans first, search engines second
- ✅ Use natural language and varied sentence structure

**Don't:**
- ❌ Keyword stuff or repeat phrases unnaturally
- ❌ Write thin content (aim for 1,500+ words)
- ❌ Use excessive bold/italic formatting
- ❌ Write in a robotic, SEO-optimized tone
- ❌ Overuse the primary keyword

---

## 📊 Required Elements Per Article

### **Content Structure (What You Generate)**

1. **Introduction:** 3-4 sentences, includes primary keyword once naturally
2. **Main Body:** 4-6 H2 sections with detailed content (1,500+ words total)
3. **Subsections:** H3 where needed for organization
4. **Internal Links:** 3-5 HTML anchor links to relevant pages/articles
5. **Conclusion:** 2-3 sentences summarizing key points

### **HTML Tags to Use in Content**

- Headings: `<h2>`, `<h3>`
- Paragraphs: `<p>`
- Lists: `<ul>`, `<ol>`, `<li>`
- Links: `<a href="/About.html">anchor text</a>`
- Bold: `<strong>` (use sparingly)
- Italic: `<em>` (use sparingly)

**Do NOT include:**
- H1 tags (title is handled by template)
- Full HTML page structure
- Meta tags, schema, or template elements
- Featured image (handled by template)

---

## 🔗 Internal Linking Strategy

**Link to these pages naturally:**
- `/About.html` - When discussing company background
- `/HowWeDoIt.html` - When explaining processes
- `/WhoWeServe.html` - When discussing target audience
- `/Integrations.html` - When mentioning CRM/tech
- `/Contact.html` - In conclusion/CTA sections
- `/articles/` - Link to related articles when relevant

**Anchor Text Examples:**
- ✅ "Learn more about our lead generation process"
- ✅ "See how Peak Leads Group helps home service businesses"
- ✅ "Check out our CRM integrations"
- ❌ "Click here"
- ❌ "This page"
- ❌ "Read more"

---

## 📝 Output Format

When generating an article, provide ONLY the content text with HTML tags:

**Content Text (for Airtable "Content" field):**

```html
<p>Intro paragraph that includes the primary keyword naturally. This sets up the article and explains what readers will learn.</p>

<h2>First Main Section</h2>
<p>Detailed content explaining the topic. Use natural language and include semantic keywords throughout.</p>

<h3>Subsection if Needed</h3>
<p>More detailed information. Include examples and practical advice.</p>

<h2>Second Main Section</h2>
<p>Continue with comprehensive content. Link naturally to relevant pages like <a href="/HowWeDoIt.html">our lead generation process</a> when it adds value.</p>

<p>Conclusion paragraph summarizing key points. May include a call-to-action link to <a href="/Contact.html">get started</a>.</p>
```

**That's it!** Just the content text with HTML tags. The template handles everything else (title, meta tags, featured image, etc.).

---

## 🎨 Example Article Content Structure

```html
<p>Qualifying home service leads before they call saves time and increases conversion rates. When you pre-qualify leads, you focus your sales team's energy on homeowners who are ready to move forward. This article covers the essential strategies for qualifying leads effectively.</p>

<h2>Why Lead Qualification Matters</h2>
<p>Lead qualification isn't just about filtering out bad leads—it's about maximizing your team's productivity. When you qualify leads upfront, you ensure your sales team spends time with homeowners who have real projects, budgets, and timelines. Learn more about <a href="/HowWeDoIt.html">our lead generation process</a> that focuses on ready-to-book homeowners.</p>

<h2>Key Qualification Questions to Ask</h2>
<p>Start with these essential questions to determine if a lead is worth pursuing:</p>
<ul>
<li>What is your project timeline?</li>
<li>What is your budget range?</li>
<li>Are you the decision maker?</li>
</ul>

<h3>Budget and Timeline Questions</h3>
<p>Understanding budget and timeline helps you prioritize leads. Ask open-ended questions that encourage homeowners to share details about their project scope and urgency.</p>

<h2>Red Flags to Watch For</h2>
<p>Certain warning signs indicate a lead may not be ready to move forward. Watch for vague timelines, unrealistic budgets, or hesitation to provide contact information.</p>

<h2>Best Practices for Lead Qualification</h2>
<p>Follow this step-by-step process to qualify leads effectively. Use your CRM to track qualification criteria and automate follow-up. <a href="/Integrations.html">Check out our CRM integrations</a> to streamline the process.</p>

<p>Qualifying leads upfront ensures your sales team focuses on homeowners ready to book. Start implementing these strategies today to improve your conversion rates. <a href="/Contact.html">Contact us</a> to learn how we deliver pre-qualified, ready-to-book leads.</p>
```

---

## ✅ Quality Checklist

Before finalizing content, ensure:

- [ ] Primary keyword in first paragraph once, naturally
- [ ] Primary keyword in 2-3 H2 headings where it makes sense
- [ ] Semantic keywords used throughout naturally
- [ ] 1,500+ words of quality, helpful content
- [ ] Proper heading hierarchy (H2 → H3, no H1)
- [ ] 3-5 internal links with descriptive anchor text using HTML tags
- [ ] Natural, readable tone (not keyword-stuffed)
- [ ] All HTML tags properly formatted (h2, h3, p, ul, li, a)
- [ ] Introduction paragraph (3-4 sentences)
- [ ] Conclusion paragraph (2-3 sentences)
- [ ] Content is comprehensive and actionable

---

## 🚀 Usage Instructions

**When I request an article, I'll provide:**

1. **Topic/Title:** "How to Qualify Home Service Leads"
2. **Primary Keyword:** "qualify home service leads"
3. **Secondary Keywords:** "lead qualification", "pre-qualify leads"
4. **Target Audience:** Home service business owners
5. **Word Count:** 2,000 words
6. **Internal Links:** Link to HowWeDoIt.html, About.html, Contact.html

**You should:**
1. Generate natural, helpful content text with HTML tags
2. Include SEO elements without being spammy
3. Structure with proper H2/H3 headings
4. Add internal links naturally using HTML anchor tags
5. Output ONLY the content text (no full HTML page structure)
6. Content will be inserted into Airtable "Content" field

---

## 📚 Context Files You'll Receive

1. **sitemap.xml** - Site structure and existing pages
2. **ARTICLE-TEMPLATE.html** - HTML template structure (for reference - you generate content only)
3. **WEBSITE-COPY-FOR-CLAUDE.md** - All website copy for brand voice and messaging reference
4. **Example articles** - For tone/style reference (if available)

---

## 💡 Tips for Natural SEO

**Instead of:**
> "If you want to qualify home service leads, you need to qualify home service leads by asking qualification questions about home service leads."

**Write:**
> "Qualifying leads before they call saves time and increases conversion rates. Start by asking about their project timeline, budget, and decision-making process."

**Key:** Write for humans, optimize for search engines naturally.

---

## 📌 Important Reminders

1. **You're generating CONTENT TEXT ONLY** - Not full HTML pages
2. **Use HTML tags** for headings (h2, h3), paragraphs (p), lists (ul, li), and links (a)
3. **No H1 tags** - The title is handled by the template
4. **No meta tags, schema, or template elements** - Those are automated
5. **Focus on quality content** - 1,500+ words, helpful, actionable
6. **Natural SEO** - Include keywords naturally, don't stuff
7. **Internal links** - Use HTML anchor tags: `<a href="/About.html">anchor text</a>`

---

**Ready to generate articles!** When I provide a topic, generate SEO-optimized, natural content text with HTML tags ready for the Airtable "Content" field.

