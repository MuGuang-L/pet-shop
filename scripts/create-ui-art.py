"""Original, deterministic sample illustrations. No external assets or fonts."""
from PIL import Image, ImageDraw
from pathlib import Path
OUT=Path(__file__).resolve().parents[1]/'miniprogram/assets'
OUT.mkdir(exist_ok=True)
def canvas(w=640,h=640,bg='#F8F1E4'):
    im=Image.new('RGB',(w,h),bg); return im,ImageDraw.Draw(im)
def cat(d,x,y,s=1):
    def box(b): return tuple(int(v*s+(x if i%2==0 else y)) for i,v in enumerate(b))
    d.ellipse(box((15,100,225,300)),fill='#F3BA6B');d.polygon([ (x+int(a*s),y+int(b*s)) for a,b in [(10,65),(30,-10),(85,35),(155,35),(210,-10),(230,65)]],fill='#F3BA6B')
    d.ellipse(box((5,30,235,220)),fill='#F3BA6B');d.ellipse(box((62,122,178,206)),fill='#FFF2DC')
    for a in [65,163]: d.ellipse(box((a,94,a+12,112)),fill='#332A26')
    d.polygon([(x+int(a*s),y+int(b*s)) for a,b in [(110,132),(130,132),(120,144)]],fill='#79503D')
    for a in [0,180]: d.line(box((a,140,a+52,150)),fill='#AC7C4C',width=max(2,int(3*s)))
    for a in [88,112,136]: d.rounded_rectangle(box((a,35,a+12,64)),radius=6,fill='#D99245')
    d.rounded_rectangle(box((44,251,112,304)),radius=int(18*s),fill='#FFF2DC');d.rounded_rectangle(box((128,251,196,304)),radius=int(18*s),fill='#FFF2DC')
def dog(d,x,y,s=1):
    def b(z): return tuple(int(v*s+(x if i%2==0 else y)) for i,v in enumerate(z))
    d.ellipse(b((24,115,225,302)),fill='#FCF8EE');d.ellipse(b((15,15,235,218)),fill='#FCF8EE')
    d.ellipse(b((-5,30,65,160)),fill='#A46F4C');d.ellipse(b((183,30,252,160)),fill='#A46F4C')
    d.ellipse(b((141,65,199,132)),fill='#D9AD7D')
    for a in [73,166]:d.ellipse(b((a,88,a+12,106)),fill='#332A26')
    d.ellipse(b((96,122,151,151)),fill='#332A26');d.arc(b((103,138,149,181)),0,180,fill='#332A26',width=max(3,int(4*s)))
    d.rounded_rectangle(b((65,203,188,222)),radius=int(9*s),fill='#EB7959');d.ellipse(b((114,218,139,244)),fill='#FFD66A')
    for a in [40,139]:d.rounded_rectangle(b((a,263,a+65,310)),radius=int(20*s),fill='#F1E6D4')
def save(im,name):im.save(OUT/(name+'.png'),optimize=True)
im,d=canvas(1200,800,'#FFE39A')
d.ellipse((680,-250,1450,580),fill='#FFEDBE');d.ellipse((-150,580,1380,1100),fill='#F4CB72')
cat(d,610,252,1.25);dog(d,870,252,1.18)
for x,y in [(550,100),(1100,150),(580,550)]:d.ellipse((x,y,x+13,y+13),fill='#FFF8E8')
save(im,'hero')
for name,fn,bg in [('cat',cat,'#FFEDC7'),('dog',dog,'#EEEADF')]:
    im,d=canvas();d.ellipse((80,500,560,570),fill='#E8DCC6');fn(d,100,85,1.8);save(im,name)
im,d=canvas(bg='#F4EDDD');d.ellipse((110,525,530,580),fill='#E0D5BE');d.polygon([(190,100),(450,100),(480,535),(155,535)],fill='#D5A766');d.rectangle((190,100,450,127),fill='#6C7A50');d.rounded_rectangle((190,185,444,440),radius=20,fill='#FAF5E7');d.ellipse((245,225,390,370),fill='#EBD4A8');cat(d,279,253,.36);d.rectangle((238,397,402,410),fill='#6C7A50');save(im,'food')
im,d=canvas(bg='#EEEDE4');d.ellipse((100,500,540,555),fill='#DDDACC')
for off,col in [(0,'#B68157'),(14,'#E1B480'),(28,'#7E8E70')]:d.line([(160+off,440),(320+off,190),(480+off,440)],fill=col,width=30)
for x in [145,465]:d.ellipse((x-45,398,x+65,498),fill='#D9AD78')
save(im,'toy')
im,d=canvas(bg='#F0E9E1');d.ellipse((150,515,500,570),fill='#DED2C7');d.rounded_rectangle((285,280,365,530),radius=32,fill='#AD8061');d.rounded_rectangle((195,130,450,355),radius=70,fill='#CFA784');d.rounded_rectangle((218,148,427,326),radius=50,fill='#EBDBC9')
for x in range(248,408,25):
 for y in range(174,312,24):d.ellipse((x,y,x+6,y+10),fill='#75685B')
save(im,'care')
im,d=canvas(800,600,'#FAF7EF');cat(d,460,135,1);d.line([(175,190),(215,400),(450,400),(490,240),(195,240)],fill='#AA9576',width=13);d.line([(135,180),(175,190)],fill='#AA9576',width=13)
for x in [240,420]:d.ellipse((x-20,428,x+20,468),fill='#514B42')
save(im,'empty')
print('Created 7 original PNG illustrations')
