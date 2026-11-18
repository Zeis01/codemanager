# CodeManager: lista składowych modułu / obiektu Pythona dla podpowiedzi edytora.
# Użycie: python pyintrospect.py members <ścieżka.kropkowa> [...]   |   python pyintrospect.py modules
import sys, json, importlib, inspect, pkgutil, builtins, io, contextlib

BLOCK = {'antigravity', 'this', '__hello__', '__phello__', 'idlelib.idle'}

def kind(o, name):
    if inspect.ismodule(o): return 'module'
    if inspect.isclass(o): return 'class'
    if inspect.isroutine(o) or callable(o): return 'function'
    if name.isupper(): return 'constant'
    return 'variable'

def sig(o):
    try:
        return str(inspect.signature(o))
    except Exception:
        d = (getattr(o, '__doc__', None) or '').strip().split('\n')[0]
        return d[d.index('('):] if '(' in d and d.index('(') < 60 else ''

def resolve(path):
    parts = path.split('.')
    if parts[0] in BLOCK or path in BLOCK: raise ImportError('pominięto')
    obj = None; i = len(parts)
    with contextlib.redirect_stdout(io.StringIO()):
        while i > 0:
            name = '.'.join(parts[:i])
            if name in BLOCK: raise ImportError('pominięto')
            try:
                obj = importlib.import_module(name); break
            except Exception:
                i -= 1
    if obj is None:
        obj = builtins; i = 0
    for p in parts[i:]:
        obj = getattr(obj, p)
    return obj

def members(path):
    o = resolve(path)
    out = []
    names = set(dir(o))
    sub = set()
    if inspect.ismodule(o) and hasattr(o, '__path__'):
        try:
            for m in pkgutil.iter_modules(o.__path__):
                if not m.name.startswith('_'): sub.add(m.name)
        except Exception: pass
    for n in sorted(names | sub):
        if n.startswith('__') and n.endswith('__') and n not in ('__init__', '__name__', '__file__', '__doc__', '__version__'): continue
        try:
            v = getattr(o, n) if n in names else None
        except Exception:
            v = None
        if v is None and n in sub:
            out.append({'n': n, 'k': 'module'}); continue
        k = kind(v, n)
        e = {'n': n, 'k': k}
        if k in ('function', 'class'):
            s = sig(v)
            if s: e['s'] = s[:160]
        try:
            d = inspect.getdoc(v) if k != 'variable' and k != 'constant' else None
        except Exception:
            d = None
        if d and k != 'module': e['d'] = d[:500]
        elif k == 'module' and d: e['d'] = d.split('\n')[0][:200]
        if k in ('variable', 'constant'):
            t = type(v).__name__
            e['t'] = t
            if isinstance(v, (int, float, bool)) or (isinstance(v, str) and len(v) < 40): e['v'] = repr(v)
        out.append(e)
    return out

def modules():
    names = set(sys.builtin_module_names)
    for m in pkgutil.iter_modules():
        names.add(m.name)
    return sorted(n for n in names if not n.startswith('_') and n not in BLOCK)

if __name__ == '__main__':
    if hasattr(sys.stdout, 'reconfigure'): sys.stdout.reconfigure(encoding='utf-8')
    cmd = sys.argv[1] if len(sys.argv) > 1 else ''
    res = {'version': '%d.%d' % sys.version_info[:2]}
    if cmd == 'modules':
        res['modules'] = modules()
    elif cmd == 'members':
        res['members'] = {}
        for p in sys.argv[2:]:
            try: res['members'][p] = members(p)
            except Exception as ex: res['members'][p] = {'error': str(ex)[:200]}
    print(json.dumps(res, ensure_ascii=False))
