import asyncio, pathlib, json
from playwright.async_api import async_playwright
here = pathlib.Path(__file__).parent
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(channel="msedge", headless=True)
        pg = await b.new_page()
        await pg.goto((here / "measure.html").as_uri())
        out = await pg.evaluate("""() => Object.fromEntries([...document.querySelectorAll('div[data-k]')].map(d => { const g = d.querySelector('svg > g'); const bb = g.getBBox(); return [d.dataset.k, [Math.round(bb.x), Math.round(bb.y), Math.round(bb.width), Math.round(bb.height)]]; }))""")
        (here / "bbox.json").write_text(json.dumps(out, indent=1))
        print(json.dumps(out))
        await b.close()
asyncio.run(main())
