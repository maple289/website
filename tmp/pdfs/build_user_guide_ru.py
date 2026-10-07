from pathlib import Path
import json
from xml.sax.saxutils import escape

from PIL import Image, ImageChops
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.colors import HexColor, Color, white
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import Paragraph
from reportlab.lib.utils import ImageReader


ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'output' / 'pdf'
SHOTS = OUT / 'screenshots'
PDF = OUT / 'MyHostage_User_Guide_RU.pdf'
OUT.mkdir(parents=True, exist_ok=True)

for name, filename in [('ArialRU', 'arial.ttf'), ('ArialRU-Bold', 'arialbd.ttf'), ('ArialRU-Italic', 'ariali.ttf')]:
    pdfmetrics.registerFont(TTFont(name, str(Path('C:/Windows/Fonts') / filename)))
pdfmetrics.registerFontFamily('ArialRU', normal='ArialRU', bold='ArialRU-Bold', italic='ArialRU-Italic', boldItalic='ArialRU-Bold')

W, H = A4
M = 40
CW = W - 2 * M
INK = HexColor('#182b47')
MUTED = HexColor('#52657d')
BLUE = HexColor('#2563eb')
LINE = HexColor('#dbe4f0')
BG = HexColor('#f7f9fc')
CHECKS = []
PAGE = 0
C = canvas.Canvas(str(PDF), pagesize=A4, pageCompression=1)
C.setTitle('MyHostage - краткое руководство пользователя со скриншотами')
C.setAuthor('MyHostage')
C.setSubject('Регистрация, загрузка, просмотр, файлы, доступ, реакции и настройки')
C.setCreator('MyHostage User Guide')


def para(text, x, top, width, size=10.4, leading=14.6, color=INK, bold=False, allow_footer=False):
    style = ParagraphStyle('body', fontName='ArialRU-Bold' if bold else 'ArialRU',
        fontSize=size, leading=leading, textColor=color, spaceAfter=0, splitLongWords=True)
    p = Paragraph(text, style)
    _, height = p.wrap(width, 1000)
    if top + height > H - 46 and not allow_footer:
        raise ValueError(f'Page {PAGE}: text exceeds footer: {text[:80]} at {top + height:.1f}')
    p.drawOn(C, x, H - top - height)
    CHECKS.append((PAGE, 'text', round(top + height, 2)))
    return top + height


def rule(top):
    C.setStrokeColor(LINE)
    C.setLineWidth(.6)
    C.line(M, H - top, W - M, H - top)


def start(number, title, intro):
    global PAGE
    PAGE = number
    C.setFillColor(BG)
    C.rect(0, 0, W, H, fill=1, stroke=0)
    C.setFillColor(INK)
    C.rect(0, H - 8, W, 8, fill=1, stroke=0)
    para('MyHostage', M, 25, 160, size=12, leading=15, bold=True)
    para('РУКОВОДСТВО ПОЛЬЗОВАТЕЛЯ', 240, 28, W - 240 - M, size=8.1, leading=10, color=MUTED)
    C.setFillColor(BLUE)
    C.roundRect(M, H - 89, 31, 31, 8, fill=1, stroke=0)
    C.setFillColor(white)
    C.setFont('ArialRU-Bold', 12)
    C.drawCentredString(M + 15.5, H - 78, f'{number:02}')
    para(title, M + 43, 59, CW - 43, size=23, leading=29, bold=True)
    para(intro, M, 101, CW, size=10, leading=14, color=MUTED)
    rule(H - 41)
    para('myhostage.ca/video/  •  Русская версия  •  04.10.2026', M, H - 32, CW - 45,
        size=7.6, leading=10, color=MUTED, allow_footer=True)
    C.linkURL('https://myhostage.ca/video/', (M, 17, M + 100, 35), relative=0)
    C.setFont('ArialRU', 8)
    C.setFillColor(MUTED)
    C.drawRightString(W - M, 20, f'{number} / 6')
    C.bookmarkPage(f'page{number}')
    C.addOutlineEntry(title, f'page{number}', level=0, closed=False)


def box(x, top, width, height, color='#ffffff', border='#dbe4f0'):
    C.setFillColor(HexColor(color))
    C.setStrokeColor(HexColor(border))
    C.setLineWidth(.6)
    C.roundRect(x, H - top - height, width, height, 10, fill=1, stroke=1)


def note(title, text, top, height, kind='info', x=M, width=CW):
    colors = {'info': ('#eef4ff', '#cadcff', '#1d4ed8'),
        'warning': ('#fff7e7', '#ecd5a1', '#845211'),
        'danger': ('#fff0f1', '#efc6cd', '#a3263c')}
    bg, border, fg = colors[kind]
    box(x, top, width, height, bg, border)
    para(title, x + 14, top + 11, width - 28, size=10.3, leading=14, bold=True, color=HexColor(fg))
    end = para(text, x + 14, top + 31, width - 28, size=9.7, leading=13.5, color=HexColor(fg))
    if end > top + height - 8:
        raise ValueError(f'Page {PAGE}: note {title} exceeds box')


def image(name, x, top, width, caption, crop=None, dialog=False, max_height=None):
    im = Image.open(SHOTS / name).convert('RGB')
    if crop:
        im = im.crop(crop)
    if dialog:
        channels = [im.getchannel(ch).point(lambda v: 255 if v > 245 else 0) for ch in ('R', 'G', 'B')]
        mask = ImageChops.multiply(ImageChops.multiply(channels[0], channels[1]), channels[2])
        bounds = mask.getbbox()
        if not bounds:
            raise ValueError('Cannot find dialog bounds in ' + name)
        l, t, r, b = bounds
        im = im.crop((max(0, l-8), max(0, t-8), min(im.width, r+8), min(im.height, b+8)))
    height = width * im.height / im.width
    if max_height and height > max_height:
        width *= max_height / height
        height = max_height
    box(x - 1, top - 1, width + 2, height + 2, '#ffffff', '#ccd8e6')
    C.drawImage(ImageReader(im), x, H - top - height, width=width, height=height)
    end = para(caption, x, top + height + 7, width, size=8.4, leading=11.3, color=MUTED)
    CHECKS.append((PAGE, name, round(top+height, 2)))
    return end


def bullet(title, text, x, top, width, number=None, size=10.4):
    prefix = f'<b>{number}. {title}</b>' if number else f'<b>{title}</b>'
    return para(prefix + ' ' + text, x, top, width, size=size, leading=14.6)


# 1. A compact cover that also explains the two distinct navigation scopes.
start(1, 'Знакомство с сайтом', 'Видео, фотографии и документы: храните для себя или открывайте доступ другим.')
para('<b>Адрес:</b> <link href="https://myhostage.ca/video/" color="#2563eb">https://myhostage.ca/video/</link>', M, 134, CW)
image('07-home-workspace.jpg', M, 165, CW,
    'Рис. 1. Главная страница после входа: сверху публичные библиотеки, слева личное пространство.',
    crop=(0, 0, 1050, 618))
top = 498
box(M, top, CW, 157)
rows = [
    ('Videos / Photos / Files', 'Публичные материалы. Просмотр доступен также гостям.'),
    ('My Videos / My Photos', 'Ваши загруженные видео и фотографии, включая приватные.'),
    ('File Storage', 'Ваши файлы, папки и материалы, которыми с вами поделились.'),
    ('Settings / Statistics', 'Профиль, пароль и статистика вашего контента.'),
]
for i, (label, text) in enumerate(rows):
    y = top + 12 + i * 35
    para(label, M + 14, y, 180, size=10.1, leading=14, bold=True)
    para(text, M + 199, y, CW - 213, size=9.8, leading=13.2)
note('Как работает MyHostage',
    'Браузер показывает интерфейс; сервер проверяет права и обрабатывает материалы. База хранит сведения, '
    'а хранилище - сами файлы. Прямая ссылка не даёт доступа к приватному контенту.', 673, 93)
para('На телефоне личные разделы открываются кнопкой меню. Названия кнопок в руководстве сохранены как на сайте.',
    M, 771, CW, size=8.5, leading=11, color=MUTED)
C.showPage()


# 2. Actual empty forms; no account was requested for these screenshots.
start(2, 'Регистрация и первый вход', 'Email служит логином. Имя и фамилия необязательны; заявку одобряет администратор.')
col = (CW - 20) / 2
a = image('03-registration.jpg', M, 139, col, 'Рис. 2. Create one открывает заявку на регистрацию.', dialog=True, max_height=323)
b = image('02-sign-in.jpg', M + col + 20, 139, col, 'Рис. 3. Sign in: email и пароль для входа.', dialog=True, max_height=323)
y = max(a, b) + 18
for n, title, text in [
    (1, 'Отправьте заявку.', 'Sign in → Create one. Введите email и при желании имя и фамилию; нажмите Request account.'),
    (2, 'Дождитесь одобрения.', 'После сообщения об отправке не нажимайте повторно. Если письмо не пришло, проверьте «Спам».'),
    (3, 'Первый вход.', 'После одобрения укажите email и оставьте пароль пустым. Сайт сразу потребует создать пароль.'),
    (4, 'Создайте пароль.', 'Заполните New Password и Confirm New Password; сохраните. Далее используйте этот пароль.'),
]:
    y = bullet(title, text, M, y, CW, number=n, size=10.1) + 9
note('Пустой пароль разрешён только для первоначальной настройки',
    'После создания пароля пустое поле больше не принимается. После обычного входа открывается Home.', y + 3, 72, kind='warning')
para('Если email уже занят, войдите в существующий аккаунт или укажите другой адрес.', M, y + 86, CW,
    size=9.2, leading=12, color=MUTED)
C.showPage()


# 3. Video/image upload areas are illustrated before selecting or sending files.
start(3, 'Загрузка материалов', 'Upload и перетаскивание поддерживают несколько файлов; состояние видно для каждого.')
image('09-upload-video.jpg', M, 141, col, 'Рис. 4. Область загрузки видео.', dialog=True, max_height=215)
image('15-upload-photo.jpg', M + col + 20, 141, col, 'Рис. 5. Область загрузки фотографий.', dialog=True, max_height=215)
y = 393
for n, title, text in [
    (1, 'Выберите место.', 'Откройте My Videos, My Photos или нужную папку в File Storage.'),
    (2, 'Добавьте файлы.', 'Нажмите Upload либо перетащите файлы в выделенную область. Можно выбрать несколько сразу.'),
    (3, 'Настройте доступ.', 'Для видео и фотографий выберите Private / Public. При одиночной загрузке можно изменить название.'),
    (4, 'Дождитесь передачи.', 'Не закрывайте вкладку до окончания загрузки. Ошибка одного файла не останавливает остальные.'),
]:
    y = bullet(title, text, M, y, CW, number=n) + 10
note('Статусы видео', '<b>Uploading</b> - передача файла; <b>Processing</b> - обработка на сервере; '
    '<b>Ready</b> - готово к просмотру. После передачи можно пользоваться сайтом, пока сервер обрабатывает видео.', 594, 91)
note('Если обработка не удалась', '<b>Processing Failed</b>: прочитайте ошибку. Используйте '
    '<b>Retry Processing</b>, если доступно, или <b>Delete Failed Upload</b>. Неудачная загрузка остаётся управляемой.',
    701, 77, kind='warning')
para('В Videos принимаются видео, в Photos - изображения; File Storage принимает разные типы в пределах ограничений сайта.',
    M, 560, CW, size=9.1, leading=12, color=MUTED)
C.showPage()


# 4. Real viewer and the real six-reaction menu, opened without a mutation.
start(4, 'Просмотр и реакции', 'Нажмите готовую карточку. Search, сортировка и фильтры помогают найти материал.')
image('05-photo-viewer.jpg', M, 140, CW, 'Рис. 6. Photo Viewer: стрелки перехода и X для закрытия.')
y = 465
rows = [
    ('Компьютер', '→ / Пробел - следующая; ← / Alt + Пробел - предыдущая.'),
    ('Мышь', 'Колесо вниз - следующая фотография; вверх - предыдущая.'),
    ('Телефон / планшет', 'Свайп влево - следующая; вправо - предыдущая. Двойное касание увеличивает область просмотра, повторное возвращает её.'),
]
for label, text in rows:
    para(label, M, y, 145, size=9.8, leading=13.3, bold=True)
    end = para(text, M + 150, y, CW - 150, size=9.7, leading=13.3)
    y = max(y + 23, end + 7)

bounds = json.loads((SHOTS / 'reaction-bounds.json').read_text())
card, menu = bounds['card'], bounds['menu']
left = int(min(card['x'], menu['x']) - 8)
top = int(min(card['y'], menu['y']) - 8)
right = int(max(card['x'] + card['width'], menu['x'] + menu['width']) + 8)
bottom = int(max(card['y'] + card['height'], menu['y'] + menu['height']) + 8)
image('14-reactions.jpg', M, 600, 117, 'Рис. 7. Меню реакций открывается вверх.', crop=(left, top, right, bottom), max_height=145)
para('Реакции и редактирование', M + 135, 601, CW - 135, size=12, leading=17, bold=True)
para('Кнопка реакции открывает шесть вариантов: Like, Dislike, Smile, LOL, Love, Angry. '
    'Выберите один; другой заменяет текущий, повторное нажатие выбранного снимает реакцию. '
    'Счётчик показывает участников. Для добавления нужен вход.', M + 135, 629, CW - 135, size=10.1, leading=14.4)
para('<b>Edit</b> у собственных видео и фотографий меняет название и Private / Public. '
    '<b>Save</b> сохраняет, <b>Cancel</b> отменяет. У видео также настраивается картинка предварительного просмотра.',
    M + 135, 720, CW - 135, size=10.1, leading=14.4)
C.showPage()


# 5. File workspace, preview/sharing explanation and an explicit deletion distinction.
start(5, 'Файлы, доступ и удаление', 'File Storage - личное управление; Files сверху - только публичная библиотека.')
image('10-file-storage.jpg', M, 140, CW,
    'Рис. 8. File Storage: папки, поиск, Upload, варианты Grid / List / Tree View и Trash.', crop=(0, 0, 1050, 540))
y = 432
y = bullet('Папки и поиск.', 'New folder создаёт папку. Используйте путь сверху и Назад / Вперёд браузера. '
    'Search ищет названия во всех доступных папках, в публичной библиотеке - только публичные.', M, y, CW, size=10) + 10
y = bullet('Меню ⋯ и Preview.', 'Доступные действия: просмотр, Download, переименование, перемещение, копирование, '
    'Share и удаление. Preview показывает PDF, изображения, текст, CSV и поддерживаемые документы Office. '
    'Generating preview… означает подготовку; оригинал не меняется. Для остальных форматов используйте Download.',
    M, y, CW, size=10) + 10
y = bullet('Share.', 'Найдите пользователей по email, добавьте их и нажмите Save sharing. Они могут смотреть и скачивать; '
    'управляет владелец. Everyone открывает доступ также гостям. Доступ папки наследуют текущие и будущие файлы и подпапки. '
    'Отменяйте доступ там же; унаследованный - у родительской папки.', M, y, CW, size=10) + 13
note('Удаление: проверьте, где вы находитесь',
    '<b>My Videos / My Photos:</b> окончательно, без восстановления через сайт.<br/>'
    '<b>File Storage → Move to Trash:</b> в Корзину; <b>Restore</b> возвращает.<br/>'
    '<b>Trash → Delete forever:</b> окончательно, папка удаляется с содержимым.', y, 100, kind='danger')
para('Проверьте название перед подтверждением. Cancel отменяет. При частичной ошибке повторите оставшуюся очистку согласно сообщению.',
    M, y + 111, CW, size=9, leading=12, color=MUTED)
C.showPage()


# 6. Cropped actual Settings avoids the account's email and includes no credentials.
start(6, 'Настройки и статистика', 'Личные данные, смена пароля и показатели только вашего контента.')
image('12-password.jpg', M, 141, col, 'Рис. 9. Profile и Change Password; поля оставлены пустыми.',
    crop=(198, 279, 853, 1034), max_height=292)
image('13-statistics.jpg', M + col + 20, 141, col,
    'Рис. 10. My Statistics. Числа относятся к показанной учётной записи и меняются по мере использования.',
    crop=(250, 130, 1050, 740), max_height=292)

para('Settings', M, 487, col, size=13, leading=18, bold=True)
para('Измените First Name / Last Name и нажмите Save profile. Имена можно оставить пустыми.<br/><br/>'
    '<b>Change Password:</b> текущий пароль, новый и подтверждение. Значок глаза показывает или скрывает ввод. '
    'После сохранения используйте новый пароль.', M, 517, col, size=10.2, leading=14.4)
para('Statistics', M + col + 20, 487, col, size=13, leading=18, bold=True)
para('Смотрите свои видео, фотографии и файлы, просмотры, реакции, загрузки и занимаемое место. '
    'Выберите период для графиков.<br/><br/>'
    'Чужая статистика и данные сервера обычному пользователю не доступны. Admin Console открывается только администраторам.',
    M + col + 20, 517, col, size=10.2, leading=14.4)
note('Не потеряйте несохранённые изменения',
    'При выходе из Settings с изменениями <b>Keep Editing</b> оставляет форму, '
    '<b>Discard Changes</b> отбрасывает несохранённое. Формы закрывайте их кнопками: нажатие вне окна не отменяет задачу.',
    672, 91)
para('<b>На общем устройстве:</b> завершайте работу через меню пользователя → Sign out.',
    M, 778, CW, size=9.6, leading=13, color=MUTED)
C.showPage()

C.save()
print(json.dumps({'pdf': str(PDF), 'pages': PAGE, 'bytes': PDF.stat().st_size,
    'max_content_bottom': max(bottom for _, _, bottom in CHECKS)}, ensure_ascii=False))
