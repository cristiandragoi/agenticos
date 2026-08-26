export async function dispatchHttp({ input, config, }) {
    const url = String(config.url ?? "");
    if (!url)
        throw new Error("http lane requires config.url");
    let headers = {};
    try {
        headers = JSON.parse(String(config.headers ?? "{}"));
    }
    catch {
        throw new Error(`http lane config.headers is not valid JSON`);
    }
    const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(input),
    });
    const text = await res.text();
    if (!res.ok)
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 500)}`);
    return text;
}
