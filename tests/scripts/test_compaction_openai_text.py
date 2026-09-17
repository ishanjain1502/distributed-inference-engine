#!/usr/bin/env python3
"""Two-turn compaction smoke test with a large fixed prompt."""

import json
import sys
import uuid

import requests

PROMPT_TEXT = r"""OpenAI is one of the world's leading artificial intelligence research and deployment companies, dedicated to ensuring that artificial general intelligence (AGI)—highly autonomous systems that outperform humans at most economically valuable work—benefits all of humanity. Founded in December 2015 as a non-profit organization by a group of prominent technology leaders and researchers, including Elon Musk, Sam Altman, Ilya Sutskever, Greg Brockman, Wojciech Zaremba, and John Schulman, OpenAI emerged out of a collective concern regarding the existential risks and profound societal implications associated with advanced AI. The founders envisioned an open, collaborative research institution that would prioritize human well-being, safety, and equitable distribution of technological benefits over short-term commercial profits, setting a new benchmark for transparency in the tech industry.
Over the years, OpenAI underwent a foundational evolution to scale its computational resources and accelerate its breakthroughs. Recognizing that building frontier AI models requires billions of dollars in infrastructure, specialized hardware, and elite talent, the organization transitioned into a "capped-profit" structure in 2019, establishing OpenAI Global, LLC. This unique commercial framework allowed OpenAI to attract massive institutional investments—most notably a multi-billion-dollar, multi-year strategic partnership with Microsoft—while legally retaining its core fiduciary duty to the original non-profit mission. Under the leadership of CEO Sam Altman and President Greg Brockman, OpenAI pivoted from a pure research lab into a hyper-growth product ecosystem, balancing the rigorous demands of safety engineering with commercial deployment.
OpenAI’s technological trajectory is defined by its pioneering work in generative AI and deep learning, particularly through the development of the Transformer architecture. The company achieved global prominence through its Generative Pre-trained Transformer (GPT) lineage. The release of GPT-2 in 2019 demonstrated the surprising zero-shot capabilities of large language models (LLMs) when trained on massive web datasets, though its full release was initially delayed due to concerns over automated misinformation. In 2020, OpenAI launched GPT-3, a massive 175-billion parameter model that fundamentally shifted the tech industry’s understanding of natural language processing, showcasing an unprecedented ability to write code, compose essays, translate languages, and reason abstractly.
The true watershed moment for the company, and the broader digital era, occurred on November 30, 2022, with the launch of ChatGPT. Built initially on the GPT-3.5 and later GPT-4 architectures, ChatGPT became the fastest-growing consumer application in history, democratizing artificial intelligence by giving hundreds of millions of people access to a conversational, highly intuitive interface. ChatGPT transformed global productivity, education, software engineering, and creative industries overnight, forcing global enterprises and rival tech giants to realign their core strategies around generative artificial intelligence.
OpenAI’s innovation extends far beyond text generation into multimodal AI systems that bridge the gap between different sensory inputs. The company revolutionized digital artistry with its DALL-E series, introducing neural networks capable of generating highly detailed, stylized, and contextually accurate imagery from simple natural language prompts. Following DALL-E, OpenAI introduced Sora, a groundbreaking text-to-video generation model capable of synthesizing highly realistic, physics-compliant 60-second cinematic scenes from textual descriptions, representing a massive leap forward in spatial computing and computer vision. Furthermore, OpenAI pioneered advanced voice and conversational capabilities, developing models that can detect human emotion, match vocal inflections, and communicate with zero latency, making human-computer interactions indistinguishable from natural dialogue.
As AI models evolved from passive digital assistants into proactive problem solvers, OpenAI pioneered the frontier of reasoning and agentic AI. Through breakthroughs in reinforcement learning and chain-of-thought processing, OpenAI developed specialized model series designed to think, verify, and reason through complex scientific, mathematical, and cryptographic problems before responding. These advancements laid the groundwork for agentic computing environments, empowering AI agents to execute multi-step workflows, manage vast data pipelines, build complex applications, and act autonomously across enterprise environments to achieve sophisticated business goals.
Operating at the absolute frontier of technology, OpenAI carries a profound responsibility regarding AI safety, ethics, and governance. The company maintains dedicated safety teams focused on alignment science, algorithmic bias mitigation, and preventing the weaponization or misuse of AI in sensitive areas like cybersecurity, biochemical engineering, and political disinformation. OpenAI actively collaborates with international governments, academic institutions, and regulatory bodies to help shape global frameworks for responsible AI deployment. By championing rigorous red-teaming practices and advocating for international safety standards, the organization strives to mitigate the systemic risks of rapid technological displacement while maximizing the creative, economic, and scientific democratization that artificial intelligence promises to bring to global society.
To fulfill this massive vision, OpenAI continues to construct and manage some of the largest computational infrastructures on Earth. By utilizing state-of-the-art supercomputers developed in partnership with major cloud providers, the company continuously pushes the boundaries of hardware efficiency, distributed training algorithms, and neural network scale. This computing power enables the training of models that don't just mimic human responses, but actively learn deep representations of the physical and digital world. Through this methodology, the organization envisions a future where artificial intelligence functions as a universal cognitive utility—powering scientific breakthroughs, optimizing clean energy grids, designing life-saving therapeutics, and expanding the horizons of human knowledge.
At the core of OpenAI’s operational philosophy is the fundamental belief that the transition to an AI-driven society must be handled with extreme care and inclusivity. The company regularly updates its public charters and deployment policies to reflect real-world feedback, acknowledging that technology of this magnitude cannot be developed in an academic vacuum. As the boundary between narrow applications and true artificial general intelligence grows increasingly thin, OpenAI remains committed to balancing its rapid product deployment with deep ethical reflection, ensuring that as machines become more intelligent, humanity becomes more capable, creative, and prosper
Would you like me to shorten, expand, or reformat this text into specific sections (like a corporate profile, history timeline, or a speech)? Let me know how you'd like to use it!"""


def infer_turn(conversation_id: str, prompt: str, max_tokens: int = 80) -> dict:
    url = "http://localhost:1337/coordinator/infer"
    payload = {
        "conversation_id": conversation_id,
        "prompt": prompt,
        "model": "tinyllama-1.1b",
        "max_tokens": max_tokens,
    }
    est_tokens = max(1, len(prompt) // 4)
    print(f"\n--- Turn prompt chars={len(prompt)} est_tokens~{est_tokens} max_tokens={max_tokens} ---")
    try:
        response = requests.post(url, json=payload, stream=True, timeout=300)
    except requests.exceptions.RequestException as exc:
        return {"status": 0, "error": str(exc), "tokens": 0, "body": ""}

    if response.status_code != 200:
        return {
            "status": response.status_code,
            "error": response.text[:500],
            "tokens": 0,
            "body": response.text,
        }

    tokens = []
    for line in response.iter_lines():
        if not line:
            continue
        line = line.decode("utf-8")
        if not line.startswith("data: "):
            continue
        try:
            data = json.loads(line[6:])
            if "token" in data:
                tokens.append(data["token"])
        except json.JSONDecodeError:
            pass

    text = "".join(tokens)
    preview = text[:200].replace("\n", " ")
    print(f"HTTP 200, streamed {len(tokens)} tokens, preview: {preview!r}")
    return {"status": 200, "tokens": len(tokens), "text": text, "error": None}


def main() -> int:
    conversation_id = str(uuid.uuid4())
    print(f"conversation_id={conversation_id}")
    print(f"Turn-1 prompt size: {len(PROMPT_TEXT)} chars (~{len(PROMPT_TEXT)//4} budget tokens)")

    t1 = infer_turn(conversation_id, PROMPT_TEXT, max_tokens=60)
    if t1["status"] != 200:
        print(f"TURN 1 FAILED: HTTP {t1['status']} {t1.get('error')}")
        return 1

    t2 = infer_turn(
        conversation_id,
        "In one sentence: when was ChatGPT launched and who is the OpenAI CEO?",
        max_tokens=80,
    )
    if t2["status"] != 200:
        print(f"TURN 2 FAILED: HTTP {t2['status']} {t2.get('error')}")
        if t2["status"] == 409:
            print("(409 = compaction ladder failed — check coordinator logs for compaction.failure)")
        return 1

    print("\nSUCCESS: both turns completed on same conversation_id (no client-visible 409).")
    print("Check coordinator terminal for compaction.success logs.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
