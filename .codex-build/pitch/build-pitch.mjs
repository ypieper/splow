import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Presentation, PresentationFile } from '@oai/artifact-tool';

const skillDir = '/Users/yannickpieper/.codex/plugins/cache/openai-primary-runtime/presentations/26.1013.11914/skills/presentations';
const workspaceDir = '/Users/yannickpieper/Documents/ChatGPT/SponsorProof';
const buildDir = path.join(workspaceDir, '.codex-build/pitch');
const finalPath = path.join(workspaceDir, 'output/presentations/splow-pitch-fuer-veranstalter-v2.pptx');
const draftPath = path.join(buildDir, 'draft.pptx');
const W = 1280, H = 720;
const C = { navy:'#192d40', orange:'#e75b40', coral:'#ff8769', paper:'#f4f7fa', white:'#ffffff', muted:'#78899b', pale:'#fcece7', line:'#dce5ec', green:'#3aa782', blue:'#4b8dc4' };
const FONT = 'Arial';
const presentation = Presentation.create({slideSize:{width:W,height:H}});

function shape(slide, geometry, x,y,w,h, fill='none', lineFill='none', lineWidth=0, radius) {
  return slide.shapes.add({geometry, position:{left:x,top:y,width:w,height:h}, fill,
    line:{style:'solid',fill:lineFill,width:lineWidth}, ...(radius?{borderRadius:radius}:{})});
}
function text(slide, value, x,y,w,h, size, color=C.navy, bold=false, align='left') {
  const s=shape(slide,'textbox',x,y,w,h);
  s.text=value;
  s.text.style={fontSize:size,typeface:FONT,color,bold,alignment:align,verticalAlignment:'middle',wrap:'square',autoFit:'shrinkText',insets:0};
  return s;
}
function line(slide,x,y,w,color=C.line,thickness=2) { shape(slide,'rect',x,y,w,thickness,color); }
function dot(slide,x,y,size,color=C.orange) { shape(slide,'ellipse',x,y,size,size,color); }
function brand(slide, light=false) {
  shape(slide,'roundRect',72,52,42,42,C.orange,'none',0,13);
  text(slide,'s',78,52,30,42,31,C.white,true,'center');
  text(slide,'Splow',126,52,160,42,28,light?C.white:C.navy,true);
}
function footer(slide,n, light=false) {
  text(slide,'Sponsoring einfach organisiert',72,675,500,20,13,light?'#bdc8d1':C.muted,false);
  text(slide,String(n).padStart(2,'0'),1180,675,28,20,13,light?'#bdc8d1':C.muted,true,'right');
}
function heading(slide, eyebrow, title, subtitle) {
  text(slide,eyebrow.toUpperCase(),72,126,900,22,13,C.orange,true);
  text(slide,title,72,160,1135,58,38,C.navy,true);
  if(subtitle) text(slide,subtitle,72,224,1080,48,20,C.muted,false);
}

// 1 — Cover: editorial, restrained brand-color composition.
{
 const s=presentation.slides.add(); s.background.fill=C.navy;
 shape(s,'ellipse',930,0,350,350,'#233b50');
 shape(s,'ellipse',980,410,300,300,'#20364b');
 shape(s,'roundRect',904,137,260,408,'#f7f9fb','none',0,28);
 shape(s,'roundRect',944,178,180,95,C.pale,'none',0,18);
 text(s,'SPONSOR',960,195,148,22,13,C.orange,true,'center');
 text(s,'Partnerschaft',960,223,148,28,17,C.navy,true,'center');
 line(s,944,302,180,C.line,2);
 text(s,'LEISTUNG',960,325,148,22,13,C.muted,true,'center');
 text(s,'Nachweis',960,353,148,28,17,C.navy,true,'center');
 line(s,944,432,180,C.line,2);
 dot(s,965,466,14,C.green); text(s,'Event im Blick',990,458,120,28,16,C.navy,true);
 shape(s,'roundRect',72,54,42,42,C.orange,'none',0,13); text(s,'s',78,54,30,42,31,C.white,true,'center');
 text(s,'Splow',126,54,160,42,28,C.white,true);
 text(s,'SPONSORING FÜR VERANSTALTER',72,184,620,28,15,C.coral,true);
 text(s,'Weniger Abstimmung.\nMehr Überblick.',72,236,730,152,54,C.white,true);
 text(s,'Von der Vereinbarung bis zum Leistungsnachweis –\nalles rund um Sponsoring an einem Ort.',76,421,690,74,23,'#d3dce4',false);
 line(s,76,548,620,'#43586b',2);
 text(s,'Für Festivals, Stadtfeste, Vereine und Open-Air-Events',76,572,680,36,17,'#bdc8d1',false);
 text(s,'01',1180,675,28,20,13,'#bdc8d1',true,'right');
 s.speakerNotes.text='Einstieg: Sponsoring läuft in vielen Organisationen über mehrere Werkzeuge. Splow bündelt den Ablauf vom Deal bis zum Nachweis.';
}
// 2 — The problem
{
 const s=presentation.slides.add(); s.background.fill=C.paper; brand(s); heading(s,'Der Alltag heute','Gute Partnerschaften verdienen einen klaren Ablauf.','Informationen liegen oft verteilt – und jeder nächste Schritt braucht neue Abstimmung.');
 const cols=[
  {x:82,k:'01',h:'Absprachen',d:'Angebote und Zusagen\nin E-Mails und Dateien'},
  {x:470,k:'02',h:'Umsetzung',d:'Leistungen und Aufgaben\nwerden einzeln nachgehalten'},
  {x:858,k:'03',h:'Nachweise',d:'Fotos und Belege landen\nan verschiedenen Orten'}
 ];
 for(const c of cols){
   text(s,c.k,c.x,285,60,30,15,C.orange,true);
   line(s,c.x,331,300,C.line,2);
   text(s,c.h,c.x,360,310,42,26,C.navy,true);
   text(s,c.d,c.x,414,310,76,19,C.muted,false);
 }
 text(s,'Die Folge: unnötige Rückfragen – und ein Abschluss, der mehr Arbeit macht als nötig.',82,562,1060,48,22,C.navy,true);
 footer(s,2); s.speakerNotes.text='Nicht die Partnerschaft ist kompliziert – ihre Informationen sind über zu viele Orte verteilt. Genau dort setzt Splow an.';
}
// 3 — Workflow
{
 const s=presentation.slides.add(); s.background.fill=C.white; brand(s); heading(s,'Ein durchgängiger Prozess','Vom Sponsoring-Deal zum sichtbaren Ergebnis.','Splow verbindet Vereinbarungen, Aufgaben und Nachweise in einem Event.');
 const steps=[
  {x:78,n:'1',t:'Vereinbaren',d:'Sponsoren, Verträge\nund Leistungen bündeln'},
  {x:365,n:'2',t:'Organisieren',d:'Aus Leistungen werden\nkonkrete Aufgaben'},
  {x:652,n:'3',t:'Dokumentieren',d:'Fotos und Dateien\nam Event festhalten'},
  {x:939,n:'4',t:'Belegen',d:'Leistungsnachweis\npro Sponsor erstellen'}
 ];
 line(s,112,334,1002,C.line,4);
 for(const [i,a] of steps.entries()){
  shape(s,'ellipse',a.x+18,310,52,52,i===3?C.green:C.orange);
  text(s,a.n,a.x+18,310,52,52,20,C.white,true,'center');
  text(s,a.t,a.x,391,250,38,23,C.navy,true);
  text(s,a.d,a.x,440,250,74,18,C.muted,false);
 }
 line(s,72,557,1136,C.line,1);
 text(s,'Ein gemeinsamer Stand für das ganze Team – vom ersten Deal bis zum Abschlussbericht.',72,582,1100,42,20,C.navy,true);
 footer(s,3); s.speakerNotes.text='Die vier Schritte lassen sich entlang eines Events nachvollziehen. Aufgaben können aus den vereinbarten Sponsoringleistungen abgeleitet werden; Nachweise werden dem jeweiligen Sponsor zugeordnet.';
}
// 4 — Sponsor collaboration
{
 const s=presentation.slides.add(); s.background.fill=C.paper; brand(s); heading(s,'Zusammenarbeit, die mitdenkt','Auch Sponsoren sind im Ablauf eingebunden.','Ein eigener Sponsorenbereich macht Vereinbarungen und Dateiaustausch nachvollziehbar.');
 // quiet two-column layout, no app-dashboard framing
 text(s,'VERANSTALTER',82,280,420,22,13,C.orange,true);
 text(s,'Du behältst den Überblick.',82,319,500,45,28,C.navy,true);
 const left=['Vereinbarte Leistungen je Sponsor','Aufgaben und Erfüllungsstand','Dokumente mit Herkunft und Upload-Zeit'];
 left.forEach((v,i)=>{dot(s,86,393+i*49,10,C.orange);text(s,v,110,382+i*49,470,36,18,C.muted,false);});
 line(s,632,280,2,C.line,266);
 text(s,'SPONSOR',694,280,430,22,13,C.blue,true);
 text(s,'Dein Partner arbeitet mit.',694,319,500,45,28,C.navy,true);
 const right=['Gebuchte Leistungen erneut einsehen','Angeforderte Unterlagen hochladen','Bereitgestellte Dokumente abrufen'];
 right.forEach((v,i)=>{dot(s,698,393+i*49,10,C.blue);text(s,v,722,382+i*49,470,36,18,C.muted,false);});
 shape(s,'roundRect',82,568,1116,58,C.white,C.line,1,14);
 text(s,'Ein persönlicher Zugang pro Sponsor und Event – ohne lose Datei-Anhänge in langen Mailverläufen.',104,580,1065,32,17,C.navy,true);
 footer(s,4); s.speakerNotes.text='Der Sponsorbereich ist auf das konkrete Event und den Sponsor zugeschnitten. Veranstalter können Dokumente intern halten oder gezielt für Sponsoren bereitstellen.';
}
// 5 — Close
{
 const s=presentation.slides.add(); s.background.fill=C.navy;
 shape(s,'ellipse',930,0,350,350,'#233b50');
 shape(s,'ellipse',960,420,320,300,'#20364b');
 shape(s,'roundRect',72,54,42,42,C.orange,'none',0,13); text(s,'s',78,54,30,42,31,C.white,true,'center'); text(s,'Splow',126,54,160,42,28,C.white,true);
 text(s,'MEHR ÜBERBLICK. WENIGER SUCHEN.',72,184,760,26,15,C.coral,true);
 text(s,'Damit Sponsoring\nauch im Alltag wirkt.',72,238,790,150,50,C.white,true);
 text(s,'Vereinbarungen werden zu Aufgaben.\nAufgaben werden zu nachvollziehbaren Nachweisen.',76,428,700,76,22,'#d3dce4',false);
 line(s,76,552,660,'#43586b',2);
 text(s,'Splow',76,580,180,36,24,C.white,true);
 text(s,'Sponsoring einfach organisiert.',239,582,430,32,18,'#bdc8d1',false);
 text(s,'05',1180,675,28,20,13,'#bdc8d1',true,'right');
 s.speakerNotes.text='Abschluss: Splow hilft dabei, den Sponsoringprozess vom Vereinbaren bis zum dokumentierten Ergebnis zusammenzuhalten. Übergang: Fragen, konkretes Event oder Beispielablauf besprechen.';
}

await fs.mkdir(buildDir,{recursive:true});
await fs.mkdir(path.dirname(finalPath),{recursive:true});
for (const [i,slide] of presentation.slides.items.entries()) {
 const png=await presentation.export({slide,format:'png',scale:1});
 await fs.writeFile(path.join(buildDir,`slide-${String(i+1).padStart(2,'0')}.png`),new Uint8Array(await png.arrayBuffer()));
}
await (await PresentationFile.exportPptx(presentation)).save(draftPath);
const {finalizePresentation}=await import(pathToFileURL(path.join(skillDir,'container_tools/artifact_tool_utils.mjs')).href);
const result=await finalizePresentation({
 workspaceDir,candidatePath:draftPath,finalPath,
 pythonExecutable:'/Users/yannickpieper/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3',
 integrityValidatorPath:path.join(skillDir,'container_tools/inspect_presentation_package_integrity.py'),
 layoutValidatorPath:path.join(skillDir,'container_tools/inspect_presentation_layout_geometry.py'),
 layoutArgs:['--expected-slide-size-emu','12192000,6858000','--validate-bullet-geometry','--validate-heading-fit'],
 requiredNativeTableOwnerSlides:[],
 fontPolicy:{basis:'design',families:[FONT]},verifyArtifactToolImport:true,
 receiptPath:path.join(buildDir,'validation-v2.json'),
});
console.log(JSON.stringify({finalPath,slideCount:presentation.slides.items.length,result}));
