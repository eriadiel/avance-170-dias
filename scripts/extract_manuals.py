import json, re, hashlib, sys
from pathlib import Path
import pdfplumber

ROOT=Path(sys.argv[2]); (ROOT/"manuals").mkdir(parents=True,exist_ok=True)
SOURCES=[
 ('science','Science','SC08D Science.pdf','GwT6T5'),
 ('english','English 8','English.pdf','3sKYaT'),
 ('pre-algebra','Pre-Algebra','Pre Algebra.pdf','P7cIBI'),
 ('history','U.S. History 8','History.pdf','GOw8Fx'),
 ('bible','Bible 8 (Acts; Proverbs)','BI08E BIBLIE.pdf','ZVrmtP')]

def text(chars):
    # PDF character coordinates preserve column order; remove duplicate overlay glyphs.
    unique={ (c['text'],round(c['x0'],2),round(c['top'],2)):c for c in chars }
    s=pdfplumber.utils.extract_text(list(unique.values()), x_tolerance=1.5, y_tolerance=3)
    return re.sub(r'\u00ad\n(?=[a-z])','',s).replace('\u00ad','-').replace('\u00a0',' ').strip()

classes=[]
for slug,name,filename,token in SOURCES:
    source=Path(sys.argv[1])/filename
    days=[]; current=None; active=False; finished=False
    with pdfplumber.open(source) as pdf:
        for pi,page in enumerate(pdf.pages):
            digits=[c for c in page.chars if 'Shannon' in c['fontname'] and 19<c['size']<21 and (c['text'].isdigit() or c['text']=='.')]
            # Some revised editions paint corrected lesson numbers over old numbers.
            # Retain the last glyph painted at each position (confirmed against rendering).
            digits=[c for i,c in enumerate(digits) if not any(abs(c['x0']-n['x0'])<2 and abs(c['top']-n['top'])<2 for n in digits[i+1:])]
            groups=[]
            for c in sorted(digits,key=lambda c:(round(c['top']),c['x0'])):
                if groups and abs(groups[-1][-1]['top']-c['top'])<2 and c['x0']>groups[-1][-1]['x0'] and c['x0']-groups[-1][-1]['x1']<4:
                    groups[-1].append(c)
                else: groups.append([c])
            heads=[{'day':int(''.join(c['text'] for c in g)),'x':g[0]['x0'],'y':min(c['top'] for c in g)} for g in groups if ''.join(c['text'] for c in g).isdigit()]
            if not active:
                if not any(h['day']==1 for h in heads): continue
                active=True
            if finished: break
            # Running footer is below 96% of the page. Actual body reaches 94%.
            footer=[c['top'] for c in page.chars if c['top']>page.height-65 and ('Light' in c['fontname'] and c['size']>=11.5)]
            bottom=min(footer)-3 if footer else page.height-42
            closing=[w['top'] for w in page.extract_words() if w['text']=='Congratulations!']
            if closing: bottom=min(bottom,min(closing)-3)
            body=[c for c in page.chars if 25<c['top']<bottom]
            # Small Lesson label is 3pt indented from the column edge.
            lesson_labels=[w for w in page.extract_words(extra_attrs=['size']) if w['text']=='Lesson' and 7<w['size']<10]
            right_heads=[h['x'] for h in heads if h['x']>page.width/2]
            split=min(right_heads)-45 if right_heads else (min(h['x'] for h in heads)+215 if heads else page.width/2)
            for side in [0,1]:
                cc=[c for c in body if (c['x0']>=split)==bool(side)]
                hh=sorted([h for h in heads if (h['x']>=split)==bool(side)],key=lambda h:h['y'])
                cursor=25
                for h in hh:
                    if current is not None:
                        chunk=text([c for c in cc if cursor<=c['top']<h['y']-3])
                        if chunk: current['segments'].append({'pdfPage':pi+1,'column':side+1,'text':chunk})
                    if h['day']!=len(days)+1: raise ValueError((slug,pi+1,h,len(days)))
                    current={'day':h['day'],'segments':[]}; days.append(current)
                    cursor=h['y']+23
                if current:
                    chunk=text([c for c in cc if c['top']>=cursor])
                    if chunk: current['segments'].append({'pdfPage':pi+1,'column':side+1,'text':chunk})
            if len(days)==170: finished=True
        assert len(days)==170,(slug,len(days))
    for d in days:
        raw='\n'.join(s['text'] for s in d['segments'])
        d['sourceText']=raw
        d['sourcePages']=list(dict.fromkeys(s['pdfPage'] for s in d['segments']))
        sections=[]; label='Continuation'; lines=[]
        for line in raw.splitlines():
            if line in ['Pages Taught','Lesson Taught','Materials Needed','Teacher Instructions'] or re.match(r'^[br] ',line):
                if lines: sections.append({'heading':label,'text':'\n'.join(lines).strip()})
                if line in ['Pages Taught','Lesson Taught','Materials Needed','Teacher Instructions']:
                    label=line; lines=[]
                else:
                    label='Homework' if line.startswith('b ') else 'Reminder'; lines=[line[2:]]
            else: lines.append(line)
        if lines: sections.append({'heading':label,'text':'\n'.join(lines).strip()})
        d['sections']=sections
        d['assessmentMentions']=[line for line in raw.splitlines() if re.search(r'\b(quiz|quizzes|test|exam|project|report)\b',line,re.I)]
        assert raw and '\ufffd' not in raw,(slug,d['day'])
    classes.append({'id':slug,'name':name,'source':{'filename':filename,'sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'totalPdfPages':len(pdf.pages)},'days':days})
    print(slug,len(days),'days',sum(len(d['sourceText']) for d in days),'characters',flush=True)
    (ROOT/'manuals'/f'{slug}-extracted.json').write_text(json.dumps(classes[-1],ensure_ascii=False,indent=2),encoding='utf8')
(ROOT/'manuals'/'curriculum.json').write_text(json.dumps({'totalDays':170,'classes':classes},ensure_ascii=False,indent=2),encoding='utf8')
