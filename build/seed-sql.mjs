// Prints SQL that loads the starter FAQs and blog posts into Supabase (first load only).
import { FAQS, POSTS } from "./content.mjs";
const q = (s) => "$q$" + s + "$q$";
let sql = "insert into public.faqs (question, answer, sort) values\n" +
  FAQS.map(([a, b], i) => `(${q(a)}, ${q(b)}, ${(i + 1) * 10})`).join(",\n") + ";\n";
sql += "insert into public.posts (slug, title, description, body_md, cover_image, published, published_at) values\n" +
  POSTS.map((p) => `(${q(p.slug)}, ${q(p.title)}, ${q(p.description)}, ${q(p.body_md)}, ${q(p.cover_image)}, true, '${p.published_at}')`).join(",\n") +
  "\non conflict (slug) do nothing;\n";
process.stdout.write(sql);
