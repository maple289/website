"""Rebuild the illustrated guide from USER_GUIDE_RU.md (single text source)."""
from pathlib import Path
from html import escape
from io import BytesIO
import json
import re

from PIL import Image, ImageDraw
from reportlab.pdfbase import pdfmetrics
from reportlab import rl_config
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.colors import HexColor, white
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfgen.canvas import Canvas
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak, Table, TableStyle, Image as PDFImage, KeepTogether

ROOT = Path(__file__).resolve().parents[2]
rl_config.useA85 = 0
OUT = ROOT / 'output/pdf'
SHOTS = OUT / 'screenshots'
TMP = ROOT / 'tmp/pdfs'
PDF = OUT / 'MyHostage_User_Guide_RU.pdf'
OUT.mkdir(parents=True, exist_ok=True)
SHOTS.mkdir(parents=True, exist_ok=True)
for name, file in [('Guide','arial.ttf'),('GuideBold','arialbd.ttf'),('GuideItalic','ariali.ttf'),('GuideSymbol','seguisym.ttf')]:
    pdfmetrics.registerFont(TTFont(name,str(Path('C:/Windows/Fonts') / file)))
pdfmetrics.registerFontFamily('Guide',normal='Guide',bold='GuideBold',italic='GuideItalic',boldItalic='GuideBold')
W,H = A4
M = 40
CW = W-2*M
TOTAL_PAGES = 14
INK = HexColor('#182b47')
BLUE = HexColor('#2563eb')
MUTED = HexColor('#52657d')
body = ParagraphStyle('Body',fontName='Guide',fontSize=10.2,leading=14.5,textColor=INK,spaceAfter=9)
heading = ParagraphStyle('Heading',parent=body,fontName='GuideBold',fontSize=20,leading=25,spaceAfter=14,keepWithNext=True)
cell = ParagraphStyle('Cell',parent=body,fontSize=9.5,leading=13,spaceAfter=0)
caption = ParagraphStyle('Caption',parent=body,fontSize=8,leading=10.5,textColor=MUTED,spaceAfter=10)
intro = ParagraphStyle('Intro',parent=body,fontSize=9,leading=12,textColor=MUTED)
glyphs = pdfmetrics.getFont('Guide').face.charToGlyph
symbols = pdfmetrics.getFont('GuideSymbol').face.charToGlyph

def inline(text):
    fragments = []
    for char in text:
        if ord(char) not in glyphs and not char.isspace():
            if ord(char) not in symbols:
                raise ValueError(f'Unsupported character: {char!r}')
            fragments.append(f'<font name="GuideSymbol">{escape(char)}</font>')
        else:
            fragments.append(escape(char))
    value = ''.join(fragments)
    value = re.sub(r'\[([^\]]+)\]\((https://[^)]+)\)',r'<link href="\2" color="#2563eb">\1</link>',value)
    value = re.sub(r'\*\*([^*]+)\*\*',r'<b>\1</b>',value)
    return value

def screenshot(path,crop=None,redactions=(),saved=None):
    image=Image.open(path).convert('RGB')
    draw=ImageDraw.Draw(image)
    for rect in redactions:
        draw.rounded_rectangle(rect,radius=4,fill='#dce5ef')
    if crop:
        image=image.crop(crop)
    if saved:
        image.save(SHOTS/saved)
    return image

def shot_flow(image,max_width,max_height):
    scale=min(max_width/image.width,max_height/image.height)
    stream=BytesIO();image.save(stream,format='PNG');stream.seek(0)
    return PDFImage(stream,width=image.width*scale,height=image.height*scale,hAlign='CENTER')

def visual(number):
    pictures=[]
    text=''
    if number==1:
        pictures=[screenshot(SHOTS/'16-current-home.png',crop=(0,70,751,570))]
        text='Публичная галерея. Личные разделы открываются через меню после входа.'
    elif number==2:
        pictures=[screenshot(SHOTS/'03-registration.jpg',crop=(50,82,504,677)),screenshot(SHOTS/'02-sign-in.jpg',crop=(50,112,504,647))]
        text='Слева: Request account. Справа: Sign in. Пустые формы из предыдущей редакции; порядок входа проверен по текущему интерфейсу.'
    elif number==4:
        pictures=[screenshot(SHOTS/'18-current-file-menu.png',crop=(415,15,680,464))]
        text='Меню собственной папки: Move, Copy, Paste here и Move to Trash. Paste here неактивна до Copy.'
    elif number==5:
        pictures=[screenshot(SHOTS/'17-current-files.png',crop=(492,140,1220,358))]
        text='Панель File Storage: Paste, New folder, Upload, поиск и переключатели вида.'
    elif number==7:
        pictures=[screenshot(SHOTS/'19-current-temporary-link.png',crop=(390,325,890,575))]
        text='Начальное окно Temporary Share Link. Copy Link и Valid until появятся после создания.'
    elif number==8:
        desktop=screenshot(SHOTS/'20-people-desktop-redacted.png')
        mobile=screenshot(SHOTS/'21-people-mobile-redacted.png')
        pictures=[desktop,mobile]
        text='Слева: People на компьютере. Справа: верхняя часть New conversation на телефоне; ниже есть Cancel. Имена/email скрыты.'
    elif number==10:
        pictures=[screenshot(SHOTS/'22-demo-voice-call.png'),screenshot(SHOTS/'23-demo-video-call.png')]
        text='Демонстрационные данные. Слева Voice call без видео; справа Video call с небольшим своим просмотром.'
    elif number==11:
        pictures=[screenshot(SHOTS/'24-demo-video-fullscreen.png')]
        text='Полный экран видеозвонка: собеседник, свой просмотр и кнопки внизу. Демонстрационные данные.'
    elif number==12:
        pictures=[screenshot(SHOTS/'25-demo-mobile-landscape.png')]
        text='Горизонтальный экран телефона: компактные кнопки и свой просмотр. Демонстрационные данные; набор звуковых кнопок зависит от устройства.'
    if not pictures:
        return []
    height={1:130,2:235,4:240,5:150,7:150,8:220,10:195,11:220,12:145}.get(number,150)
    if len(pictures)==1:
        flow=shot_flow(pictures[0],CW,height)
    else:
        col=(CW-16)/2
        flow=Table([[shot_flow(pictures[0],col,height),shot_flow(pictures[1],col,height)]],colWidths=[col+8,col+8])
        flow.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),0),('RIGHTPADDING',(0,0),(-1,-1),8),('TOPPADDING',(0,0),(-1,-1),0),('BOTTOMPADDING',(0,0),(-1,-1),0)]))
    return [KeepTogether([flow,Spacer(1,6),Paragraph(inline(text),caption)])]

class GuideCanvas(Canvas):
    def showPage(self):
        self.setFillColor(INK);self.rect(0,H-7,W,7,fill=1,stroke=0)
        self.setFont('GuideBold',13);self.drawString(M,H-35,'MyHostage')
        self.setFont('Guide',8);self.setFillColor(MUTED)
        self.drawRightString(W-M,H-34,'РУКОВОДСТВО ПОЛЬЗОВАТЕЛЯ')
        self.setStrokeColor(HexColor('#dbe4f0'));self.setLineWidth(.6);self.line(M,35,W-M,35)
        self.drawString(M,22,'myhostage.ca/video/  |  Русская версия  |  11.10.2026')
        self.linkURL('https://myhostage.ca/video/',(M,16,M+115,31),relative=0)
        self.drawRightString(W-M,22,f'{self._pageNumber} / {TOTAL_PAGES}')
        super().showPage()

class GuideDoc(SimpleDocTemplate):
    def afterFlowable(self,flowable):
        if isinstance(flowable,Paragraph) and flowable.style.name=='Heading':
            title=flowable.getPlainText();key='section-'+title.split('.')[0]
            self.canv.bookmarkPage(key);self.canv.addOutlineEntry(title,key,level=0,closed=False)

source=(ROOT/'USER_GUIDE_RU.md').read_text(encoding='utf-8')
parts=re.split(r'^## (.+)$',source,flags=re.M)
story=[]
for index in range(1,len(parts),2):
    title,section=parts[index:index+2];number=int(title.split('.')[0])
    if number>1:story.append(PageBreak())
    else:
        story.append(Paragraph('Обновлено 11 октября 2026 года. Видео, фото, файлы, Messages и звонки.',intro))
        story.append(Paragraph('Кнопки указаны как на сайте. Возможности зависят от прав и браузера.',intro))
    story.append(Paragraph(inline(title),heading));story.extend(visual(number))
    lines=section.strip().splitlines();i=0
    while i<len(lines):
        line=lines[i].strip()
        if not line:i+=1;continue
        if line.startswith('|'):
            rows=[]
            while i<len(lines) and lines[i].strip().startswith('|'):
                cells=[c.strip() for c in lines[i].strip().strip('|').split('|')]
                if not all(re.fullmatch(r'[-:]+',c) for c in cells):rows.append([Paragraph(inline(c),cell) for c in cells])
                i+=1
            table=Table(rows,colWidths=[CW*.32,CW*.68],repeatRows=1,hAlign='LEFT')
            table.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),('BACKGROUND',(0,0),(-1,0),HexColor('#eaf1fb')),('ROWBACKGROUNDS',(0,1),(-1,-1),[white,HexColor('#f7f9fc')]),('LINEBELOW',(0,0),(-1,0),.6,HexColor('#cbd8eb')),('LEFTPADDING',(0,0),(-1,-1),10),('RIGHTPADDING',(0,0),(-1,-1),10),('TOPPADDING',(0,0),(-1,-1),7),('BOTTOMPADDING',(0,0),(-1,-1),7)]))
            story.extend([table,Spacer(1,12)]);continue
        if re.match(r'^\d+\. ',line):
            story.append(Paragraph(inline(line),body));i+=1;continue
        block=[line];i+=1
        while i<len(lines) and lines[i].strip() and not lines[i].strip().startswith('|') and not re.match(r'^\d+\. ',lines[i].strip()):
            block.append(lines[i].strip());i+=1
        story.append(Paragraph(inline(' '.join(block)),body))

doc=GuideDoc(str(PDF),pagesize=A4,leftMargin=M,rightMargin=M,topMargin=60,bottomMargin=48,title='MyHostage - руководство пользователя (11.10.2026)',author='MyHostage',subject='Контент, доступ, файлы, Messenger и звонки')
doc.build(list(story),canvasmaker=GuideCanvas)
from pypdf import PdfReader
pages=len(PdfReader(PDF).pages)
if pages != TOTAL_PAGES:
    TOTAL_PAGES=pages
    doc.build(list(story),canvasmaker=GuideCanvas)
print(json.dumps({'pdf':str(PDF),'bytes':PDF.stat().st_size,'sections':(len(parts)-1)//2,'pages':pages},ensure_ascii=False))
