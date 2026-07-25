# -*- coding: utf-8 -*-
"""
Compact self-contained Arabic shaper + basic RTL reordering for PDF rendering
with ReportLab. Avoids external deps (arabic-reshaper / python-bidi) so it runs
in any environment. Maps base Arabic letters to their contextual presentation
forms (isolated/initial/medial/final) and emits text in visual (RTL) order.
"""
import re

# base letter -> (isolated, final, initial, medial)
FORMS = {
    'ء': ('ﺀ','ﺀ','ﺀ','ﺀ'),
    'آ': ('ﺁ','ﺂ','ﺁ','ﺂ'),
    'أ': ('ﺃ','ﺄ','ﺃ','ﺄ'),
    'ؤ': ('ﺅ','ﺆ','ﺅ','ﺆ'),
    'إ': ('ﺇ','ﺈ','ﺇ','ﺈ'),
    'ئ': ('ﺉ','ﺊ','ﺋ','ﺌ'),
    'ا': ('ﺍ','ﺎ','ﺍ','ﺎ'),
    'ب': ('ﺏ','ﺐ','ﺑ','ﺒ'),
    'ة': ('ﺓ','ﺔ','ﺓ','ﺔ'),
    'ت': ('ﺕ','ﺖ','ﺗ','ﺘ'),
    'ث': ('ﺙ','ﺚ','ﺛ','ﺜ'),
    'ج': ('ﺝ','ﺞ','ﺟ','ﺠ'),
    'ح': ('ﺡ','ﺢ','ﺣ','ﺤ'),
    'خ': ('ﺥ','ﺦ','ﺧ','ﺨ'),
    'د': ('ﺩ','ﺪ','ﺩ','ﺪ'),
    'ذ': ('ﺫ','ﺬ','ﺫ','ﺬ'),
    'ر': ('ﺭ','ﺮ','ﺭ','ﺮ'),
    'ز': ('ﺯ','ﺰ','ﺯ','ﺰ'),
    'س': ('ﺱ','ﺲ','ﺳ','ﺴ'),
    'ش': ('ﺵ','ﺶ','ﺷ','ﺸ'),
    'ص': ('ﺹ','ﺺ','ﺻ','ﺼ'),
    'ض': ('ﺽ','ﺾ','ﺿ','ﻀ'),
    'ط': ('ﻁ','ﻂ','ﻃ','ﻄ'),
    'ظ': ('ﻅ','ﻆ','ﻇ','ﻈ'),
    'ع': ('ﻉ','ﻊ','ﻋ','ﻌ'),
    'غ': ('ﻍ','ﻎ','ﻏ','ﻐ'),
    'ف': ('ﻑ','ﻒ','ﻓ','ﻔ'),
    'ق': ('ﻕ','ﻖ','ﻗ','ﻘ'),
    'ك': ('ﻙ','ﻚ','ﻛ','ﻜ'),
    'ل': ('ﻝ','ﻞ','ﻟ','ﻠ'),
    'م': ('ﻡ','ﻢ','ﻣ','ﻤ'),
    'ن': ('ﻥ','ﻦ','ﻧ','ﻨ'),
    'ه': ('ﻩ','ﻪ','ﻫ','ﻬ'),
    'و': ('ﻭ','ﻮ','ﻭ','ﻮ'),
    'ى': ('ﻯ','ﻰ','ﻯ','ﻰ'),
    'ي': ('ﻱ','ﻲ','ﻳ','ﻴ'),
}
# letters that do NOT connect to the following letter (right-joining only)
NON_CONNECT_AFTER = set('اأإآءؤرزدذوةى')
LAM_ALEF = {'ا':'ﻻﻼ','أ':'ﻷﻸ','إ':'ﻹﻺ','آ':'ﻵﻶ'}  # (isolated/initial, final/medial)
TASHKEEL = set('ًٌٍَُِّْـٰ')
AR = set(FORMS.keys()) | TASHKEEL

def _is_ar(c):
    return c in AR

def shape_word(word):
    # strip tashkeel for shaping simplicity (kept invisible visually)
    chars = [c for c in word if c not in TASHKEEL]
    n = len(chars)
    out = []
    i = 0
    while i < n:
        c = chars[i]
        prev = chars[i-1] if i > 0 else None
        nxt = chars[i+1] if i < n-1 else None
        # lam-alef ligature
        if c == 'ل' and nxt in LAM_ALEF:
            connects_prev = prev is not None and prev in FORMS and prev not in NON_CONNECT_AFTER
            iso, fin = LAM_ALEF[nxt][0], LAM_ALEF[nxt][1]
            out.append(fin if connects_prev else iso)
            i += 2
            continue
        if c not in FORMS:
            out.append(c); i += 1; continue
        connects_prev = prev is not None and prev in FORMS and prev not in NON_CONNECT_AFTER
        connects_next = nxt is not None and nxt in FORMS and c not in NON_CONNECT_AFTER
        iso, fin, ini, med = FORMS[c]
        if connects_prev and connects_next:
            out.append(med)
        elif connects_prev:
            out.append(fin)
        elif connects_next:
            out.append(ini)
        else:
            out.append(iso)
        i += 1
    return ''.join(out)

def shape(text):
    """Return visually-ordered, shaped text ready to draw LTR in ReportLab."""
    if not text:
        return text
    lines = str(text).split('\n')
    res = []
    for line in lines:
        # tokenize into arabic runs and non-arabic runs
        tokens = re.findall(r'[؀-ۿݐ-ݿﭐ-﻿]+|[^؀-ۿݐ-ݿﭐ-﻿]+', line)
        visual = []
        for tok in tokens:
            if tok and _is_ar(tok[0]):
                # shape each whitespace-separated word, reverse char order for RTL
                words = tok.split(' ')
                shaped_words = [shape_word(w)[::-1] for w in words]
                visual.append(' '.join(shaped_words))
            else:
                visual.append(tok)
        # reverse the sequence of runs so RTL reads correctly, and reverse
        # ordering of words handled above; join reversed run list
        res.append(''.join(reversed(visual)))
    return '\n'.join(res)

if __name__ == '__main__':
    for s in ['اللغة العربية', 'متوسطة القادسية', 'الصف الثالث المتوسط',
              'بتال خيرالله جمعان الزهراني', 'الطالب: علي (2026)']:
        print(s, '->', shape(s))
