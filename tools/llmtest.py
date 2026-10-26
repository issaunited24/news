import glob, os, time
from llama_cpp import Llama
path = sorted(glob.glob(os.path.expanduser('~/.cache/huggingface/hub/models--Qwen--Qwen2.5-7B-Instruct-GGUF/snapshots/*/qwen2.5-7b-instruct-q4_k_m-00001-of-00002.gguf')))[0]
t0 = time.time()
llm = Llama(model_path=path, n_ctx=6144, n_threads=os.cpu_count(), verbose=False)
print('load', round(time.time() - t0), 's')
prompt = ('Gold is at 4016, US 10y yield 4.3%, dollar index 101.9 up 0.2% today, oil 101 down 2% today. '
          'News: Iran and Gulf states hold talks to prevent escalation; oil falls on de-escalation hopes. ' * 8)
t0 = time.time()
r = llm.create_chat_completion(messages=[{'role': 'system', 'content': 'You are a macro strategist. Reply in JSON only.'},
    {'role': 'user', 'content': prompt + '\nReturn JSON {"gold":{"bias":"bullish|bearish|neutral","why":"..."},"oil":{...}} reasoning through competing effects.'}],
    max_tokens=400, temperature=0.2, response_format={'type': 'json_object'})
u = r['usage']
print('gen', round(time.time() - t0), 's', u)
print(r['choices'][0]['message']['content'][:800])
