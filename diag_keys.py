"""
Script de diagnostic : teste chaque cle Groq individuellement et montre
l'erreur exacte retournee par l'API pour chaque cle.
"""
from dotenv import load_dotenv
load_dotenv()
import os, time
from groq import Groq

keys_raw = {f'KEY_{i}': os.getenv(f'GROQ_API_KEY_{i}') for i in range(1, 7)}
keys = {k: v for k, v in keys_raw.items() if v and v.strip()}

print(f'=== TEST DES {len(keys)} CLES GROQ EN TEMPS REEL ===')
for name, key in keys.items():
    try:
        client = Groq(api_key=key)
        t0 = time.time()
        r = client.chat.completions.create(
            model='llama-3.3-70b-versatile',
            messages=[{'role': 'user', 'content': 'dis OK'}],
            max_tokens=3
        )
        elapsed = time.time() - t0
        content = r.choices[0].message.content.strip()
        print(f'[OK]   {name} ({key[:15]}...) => "{content}" ({elapsed:.1f}s)')
    except Exception as e:
        print(f'[FAIL] {name} ({key[:15]}...) => ERREUR EXACTE: {str(e)}')
    time.sleep(0.5)

print('=== FIN DU TEST ===')
