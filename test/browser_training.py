from playwright.sync_api import sync_playwright
import base64
import time

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path=r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe', args=['--use-gl=angle', '--use-angle=swiftshader'])
    page = browser.new_page()
    page.on('pageerror', lambda error: print('PAGE ERROR:', error, flush=True))
    page.goto('http://127.0.0.1:5188/', wait_until='domcontentloaded')
    page.locator('.images').first.wait_for(state='attached')
    data = page.evaluate("""() => { const c = document.createElement('canvas'); c.width = c.height = 224; const ctx = c.getContext('2d'); ctx.fillStyle = 'red'; ctx.fillRect(0, 0, 224, 224); return c.toDataURL('image/png').split(',')[1] }""")
    content = base64.b64decode(data)
    for field in page.locator('.images').all():
        field.set_input_files([{'name': f'{i}.png', 'mimeType': 'image/png', 'buffer': content} for i in range(2)])
    page.evaluate("""() => { window.trainingStatuses = []; new MutationObserver(() => window.trainingStatuses.push(document.querySelector('#status').textContent)).observe(document.querySelector('#status'), {childList: true, characterData: true, subtree: true}); }""")
    page.locator('#train').click()
    start = time.monotonic()
    last = ''
    while time.monotonic() - start < 180:
        status = page.locator('#status').inner_text()
        if status != last:
            print(round(time.monotonic() - start, 1), status, flush=True)
            last = status
        if 'Модель готова' in status or 'Ошибка обучения' in status:
            break
        page.wait_for_timeout(1000)
    print('FINAL', last, flush=True)
    assert 'Модель готова' in last, last
    statuses = page.evaluate('window.trainingStatuses')
    print('OBSERVED', statuses, flush=True)
    assert any('Обработка примеров' in status for status in statuses), 'No progress shown for processing examples'
    assert any('эпоха 1 из 25' in status for status in statuses), 'First training epoch was not reached'
    browser.close()
