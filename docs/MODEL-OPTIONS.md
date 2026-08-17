# Model options beyond Claude

Researched Aug 2026 on the brief "find a model that is not expensive but efficient".
The honest finding is that at Klaser's launch volume, **cost is not the constraint** —
so the plan's model section is reframed around what actually differs.

## The bottom line first

| Model | $/1,000 documents | ₪/document |
|---|---:|---:|
| GPT-5 nano | $0.48 | ₪0.002 |
| GPT-5 mini | $1.22 | ₪0.005 |
| GPT-5.4 nano | $1.62 | ₪0.006 |
| Gemini 3 Flash-Lite | $2.08 | ₪0.008 |
| Gemini 3.5 Flash-Lite | $3.12 | ₪0.012 |
| Gemini 3 Flash | $4.15 | ₪0.015 |
| Claude Haiku 4.5 | $8.27 | ₪0.031 |
| Claude Sonnet 5 | $24.81 | ₪0.092 |

One ~1600px page, ≈1,200-token instructions, ≈1,600-token catalogue (cached), ≈900
output tokens. Image tokens differ by vendor because each tokenises images its own
way — Claude ≈2,411 for that page, Gemini ≈1,548 (768px tiles), OpenAI ≈1,105.

Now translate that into a monthly bill:

| | 5,000 docs/mo (launch) | 50,000 docs/mo |
|---|---:|---:|
| Sonnet 5 | $124 | $1,241 |
| Haiku 4.5 | $41 | $414 |
| Gemini 3 Flash-Lite | $12 | $122 |

**The entire spread at launch volume is about $110 a month.** Set against one wrong
checklist sending an oleh to the wrong counter with the wrong papers, that is not a
number worth optimising. Choosing the cheapest model to save $110/month, and getting
worse Hebrew, would be the most expensive decision in this document.

So: pick on Hebrew accuracy and on what happens to the document after it is sent.
Revisit cost at 50k documents a month, where the spread becomes $1,100 and starts to
matter.

## What actually differs: retention

This is the axis that should drive the choice, because Klaser's documents are ID
papers, immigration records and case numbers.

| Provider | Default | Zero retention |
|---|---|---|
| **Anthropic** | Not used for training | ZDR available. Excludes `claude-fable-5`, which requires 30-day retention |
| **Google** | Paid tier not used for training; ~30-day logging for abuse detection | ZDR exists but the route is Vertex AI / enterprise DPA amendment and needs approval — **not** AI Studio |
| **OpenAI** | Paid API not used for training by default | A ZDR option exists for eligible customers; **not verified for this report** |
| **Self-hosted open weights** | No third party involved at all | By construction |

Nothing here is disqualifying, but the routes differ in effort. Anthropic's is the
shortest. Google's cheapest models are on the surface (AI Studio / Gemini Developer
API) where ZDR is hardest to get, which erodes part of the price advantage.

## Open weights

**Qwen3-VL** (Alibaba, open weights) is the serious candidate. It expanded OCR from
10 to 39 languages, **Hebrew among the 32 OCR languages**, with stated robustness to
low light, blur and tilt — exactly the failure modes of a phone photo of a creased
letter. Qwen2.5-VL-7B retains most of the OCR quality of the 72B and fits on a single
24GB GPU (RTX 4090 / L40S). That is the only option in this document where the
document never reaches a third party.

**DictaLM 3.0** (Dicta, Israel) — a 24B open-weight Hebrew sovereign LLM, initialised
from Mistral-Small-3.1-24B, purpose-built for Hebrew and beating generalist models on
Hebrew tasks. It is **text-only, no vision**, so it cannot read a photograph. But in
the split pipeline below it is a real candidate for the extraction half, and it is a
genuinely good story for this product: the Hebrew understanding running on an Israeli
open model.

**The catch is utilisation, not capability.** An H100 rents for $2–3/GPU-hour; a 24GB
card is cheaper, but either way you pay for it idle. Self-hosting breaks even against
hosted OCR at roughly 50,000–100,000 pages a month. Klaser at launch is ~5,000. Below
break-even the GPU sitting idle costs more than the entire hosted bill.

There is a middle option — open weights on a hosted inference provider (Together,
Fireworks, DeepInfra) — which gets the model without the utilisation risk. But then a
third party sees the document again, and the privacy argument for open weights
disappears. Open weights buy privacy only when *you* run them.

## The split pipeline: OCR, then a text model

Instead of one vision call, run a dedicated OCR to get Hebrew text and let a
text-only model do the catalogue-key extraction.

| Pipeline | $/1,000 |
|---|---:|
| Google Cloud Vision + GPT-5 nano | $2.00 |
| Google Cloud Vision + Gemini 3 Flash-Lite | $3.56 |
| Mistral OCR 4 batch + Gemini 3 Flash-Lite | $4.06 |
| Google Cloud Vision + Haiku 4.5 | $8.86 |
| Mistral OCR 4 + Haiku 4.5 | $11.36 |

Mistral OCR 4 is $4/1,000 pages, $2 in batch, 170 languages, and returns bounding
boxes and confidence rather than flat text. Google Cloud Vision is ~$1.50/1,000 pages
and rates among the strongest on multilingual documents.

Costs land in the same band as single-call vision, so the case for splitting is not
price. It is:

- **Bounding boxes come free**, which is exactly what workstream C needs to build form
  field maps — the OCR does the geometry the plan currently asks a model to infer.
- **The two halves become independently swappable.** A better Hebrew reader can be
  dropped in without touching extraction, and vice versa.
- **It opens the Hebrew-specialist door** — DictaLM can only be used this way.

The cost is one more hop, more latency, and one more vendor in the retention story.

## What this changes in the plan

**1. The provider becomes a config value, not a hardwired SDK.** The architecture
already permits this and it was luck rather than design: because the output is
catalogue keys under a strict JSON schema, nothing about the contract is
Anthropic-specific. Phase 0 gains one interface —

```
analyze(image: Bytes, catalogue: Catalogue, opts) -> AnalysisResult
```

— with one adapter per candidate behind it. Workstream B implements the interface,
not a vendor.

**2. Workstream F picks the model, not this table.** No published benchmark measures
Hebrew agency-letter understanding. OCRBench, DocVQA and OmniDocBench do not cover it;
Qwen3-VL's ">70% on 32 of 39 languages" is not a document-understanding number for
Hebrew. The gold set is the only evidence that will exist, so F runs every candidate
through the same 40+ letters and reports recall, false-add rate and cost per document
side by side. That is a day of work once the harness exists, and it replaces this
entire document with measurements.

**3. Sonnet 5 stays the default until F reports.** Not because it is proven best for
Hebrew — nothing is — but because at $124/month for launch volume the cost of being
wrong about accuracy dwarfs the cost of the model, its ZDR route is the shortest, and
a default is needed to build against.

## Caveats

Prices come from search-result aggregators, not vendor pricing pages — nevo, gov.il,
Wikipedia, WIPO and most vendor domains are blocked by this environment's egress
proxy. GPT-5 mini's input price reportedly halved within 90 days, so treat every
figure as a ballpark with a short shelf life and re-check before committing. The
OpenAI ZDR row is explicitly unverified.

Sources: [Gemini API pricing](https://benchlm.ai/google/api-pricing) ·
[Gemini ZDR](https://ai.google.dev/gemini-api/docs/zdr) ·
[OpenAI pricing](https://pricepertoken.com/pricing-page/provider/openai) ·
[Mistral OCR](https://mistral.ai/news/mistral-ocr/) ·
[Qwen3-VL](https://github.com/qwenlm/qwen3-vl) ·
[Dicta-LM 3.0](https://dicta.org.il/publications/DictaLM_3_0___Techincal_Report.pdf) ·
[self-hosting break-even](https://www.spheron.network/blog/best-open-source-ocr-vlm-self-host-gpu-cloud-2026/)
