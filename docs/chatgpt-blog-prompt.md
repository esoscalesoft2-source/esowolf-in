# ChatGPT prompt for ESOWOLF blog posts

The admin (/admin/ → New post → "Write a post with ChatGPT") fills in the topic, keywords and the list of existing posts for you and has a **Copy prompt** button. This file is the same template for reference. Edit the facts, links, topic groups and the cover image style (`imageStyle`) in `admin/blog-config.json`.

````text
You are writing a blog post for ESOWOLF (Ezy Sell Online) (https://esowolf.in).

ABOUT THE BUSINESS
ESOWOLF (Ezy Sell Online) is a company of MV Inc from Thiruvarur, Tamil Nadu, with 10+ years of hands-on e-commerce experience. We help Indian sellers grow on Amazon, Meesho, Myntra and Shopify with software, training and done-with-you support.

WHO READS THE BLOG
Indian online sellers and small brands — beginners and growing sellers on Amazon, Meesho, Myntra and Shopify — many of them non-native English readers.

TOPIC FOR THIS POST
- Topic / title idea: [write the topic here]
- Main keyword: [main keyword]
- Other keywords: [other keywords]
- Topic group: [choose one from the list below]
- Notes from our team: -

FACTS YOU MAY USE (use ONLY these facts about ESOWOLF)
- ESOWOLF (Ezy Sell Online) is a company of MV Inc, 2/424-2, Sivan South Street, Maruthapattinam, Thiruvarur — 610001, Tamil Nadu, India.
- The team has 10+ years of hands-on e-commerce experience.
- ESOWOLF helps sellers on Amazon, Meesho, Myntra and Shopify.
- ESO Hunt Engine: an AI-based tool that helps Amazon sellers sell their products more easily. Sign up at https://engine.esowolf.in/login
- Meesho Profit (Meesho reconciliation software): sellers upload their inventory, orders and Meesho payment reports and see their actual profit.
- Myntra Profit (Myntra reconciliation software): sellers upload their Myntra inventory, orders and payment reports and see their actual profit.
- Free live demo of Meesho Profit / Myntra Profit: 30 min – 1 hour at 3:00 PM IST. Meesho: Mon Hindi, Tue English, Fri Tamil. Myntra: Wed English, Thu Hindi, Sat Tamil.
- WOO Chat: WhatsApp automation software (auto bots) built on the official WhatsApp Business API from Meta. Live demo at https://woochatofficial.esowolf.in/live-demo
- Live webinar on growing an Amazon business: https://webinar.esowolf.in/
- Book a meeting with the team about growing Amazon sales: https://booking.closer.esowolf.in/book/amazon-increase-sales
- Contact: support@esowolf.in, phone/WhatsApp +91 97515 51117, Mon–Sat 9am to 6pm IST. We reply within 24 hours.

NEVER CLAIM
- guaranteed sales, rankings, profit or results of any number
- being an official partner, agency or reseller of Amazon, Meesho, Myntra, Shopify or Meta
- any price, fee or discount of ESOWOLF products or services (say: see the website or book a meeting)
- customer counts, reviews, testimonials, awards, case studies or statistics that are not in this list
- physical product sales, shipping or delivery — ESOWOLF sells software, training and services
Do not invent statistics, studies, reviews, testimonials, awards, customer numbers or prices. If you are not sure a fact is true, leave it out. You may explain how Amazon, Meesho, Myntra, Shopify, GST or WhatsApp work in general, but do not quote exact fees or numbers you are not sure about — tell the reader to check the platform's latest seller help page.

WRITING RULES
- Plain, friendly English for Indian readers whose first language is not English. Short sentences, short paragraphs (2–3 sentences).
- Answer the main question directly in the first 2–3 sentences and use the main keyword there.
- Title: 30–65 characters, main keyword near the start.
- Meta description: 120–160 characters, includes the main keyword.
- Article: 1,000–1,500 words (1,600–2,200 only for a big guide).
- 4–8 sections with "##" headings (no "#" title line, use "###" only inside a section).
- Include exactly one simple Markdown table.
- Use Indian context where useful (₹ for platform fees, Indian festivals and seasons, GST, Indian marketplaces). Never mention ESOWOLF's own prices.
- Add 4–8 internal links in Markdown format [text](url), ONLY to URLs from the allowed list below, and always include the main guide of the topic group.
- Add a short, honest "How ESOWOLF helps" section near the end, using only the facts above.
- End with one clear next step for the reader.
- 4–6 FAQs with short, direct answers.
- Never use these words: delve, game-changer, game changer, revolutionize, revolutionise, unlock, in today's fast-paced world.
- A YouTube link on its own line becomes a video. Do not add images.

TOPIC GROUPS AND THEIR MAIN GUIDES
- Amazon selling (TOPIC GROUP value: amazon-selling) — main guide: https://esowolf.in/#signup
- Meesho & Myntra profit (TOPIC GROUP value: meesho-myntra-profit) — main guide: https://esowolf.in/#meesho
- WhatsApp automation (TOPIC GROUP value: whatsapp-automation) — main guide: https://esowolf.in/#whatsapp
- E-commerce basics (TOPIC GROUP value: ecommerce-basics) — main guide: https://esowolf.in/blog/

ALLOWED INTERNAL LINKS
- https://esowolf.in/ — ESOWOLF home
- https://esowolf.in/#signup — ESO Hunt Engine for Amazon sellers
- https://esowolf.in/#meesho — Meesho Profit — Meesho reconciliation software
- https://esowolf.in/#myntra — Myntra Profit — Myntra reconciliation software
- https://esowolf.in/#whatsapp — WOO Chat — WhatsApp automation
- https://esowolf.in/#contact — Contact ESOWOLF
- https://esowolf.in/blog/ — ESOWOLF blog
- https://esowolf.in/policies.html#about — About ESOWOLF
- https://webinar.esowolf.in/ — Live Amazon webinar
- https://booking.closer.esowolf.in/book/amazon-increase-sales — Book a meeting
- https://bookdemo.esowolf.in/?platform=Meesho#book — Book a free Meesho Profit demo
- https://bookdemo.esowolf.in/?platform=Myntra#book — Book a free Myntra Profit demo
- https://woochatofficial.esowolf.in/live-demo — WOO Chat live demo
- https://engine.esowolf.in/login — ESO Hunt Engine sign up

EXISTING BLOG POSTS (you may link to these too)
- (no posts yet)

OUTPUT FORMAT
Reply with ONE code block only, exactly in this format (keep the labels in capitals):

```
TITLE:
META DESCRIPTION:
SUMMARY:
TOPIC GROUP:
MAIN KEYWORD:
OTHER KEYWORDS: (separated by semicolons)
SHORT LINK CODE: (2–4 words, lowercase, joined with hyphens)
IMAGE PROMPT: (2–3 sentences describing ONE cover image for this post: the objects and scene only, e.g. parcels, a phone, charts, an Indian seller — no text, no logos)
COVER ALT TEXT: (one sentence describing that image for blind readers)
FAQ:
Q:
A:
Q:
A:
ARTICLE:
(Markdown, ## headings, no # title line)
END OF ARTICLE
```
````
