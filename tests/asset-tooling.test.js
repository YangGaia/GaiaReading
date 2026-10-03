'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const python = process.env.PYTHON || 'python';
const options = {
  cwd: os.tmpdir(),
  encoding: 'utf8',
  windowsHide: true,
  env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', PYTHONIOENCODING: 'utf-8' },
};
const available = spawnSync(python, ['-B', '-c', 'import sys'], options).status === 0;
const pythonSkip = available ? false : '可选素材工具验证需要 Python；可通过 PYTHON 指定解释器';

function runPython(source) {
  const result = spawnSync(python, ['-B', '-c', source, root], options);
  assert.equal(result.status, 0, result.error?.message || result.stderr || result.stdout);
}

test('素材工具从任意工作目录定位当前仓库内有效输入输出', { skip: pythonSkip }, () => {
  runPython(String.raw`
import ast
import sys
from pathlib import Path
root = Path(sys.argv[1]).resolve()
for name in ('make-pet-face-tiles.py', 'make-pet-eye-tiles.py', 'make-pet-head-parts.py', 'slice-expression-sheet.py'):
    script = root / 'scripts' / name
    tree = ast.parse(script.read_text(encoding='utf-8'), filename=str(script))
    compile(tree, str(script), 'exec')
    keys = {'ROOT', 'PET_ROOT', 'CELLS', 'SRC', 'OUT', 'MAPPING'}
    setup = [node for node in tree.body if
             isinstance(node, ast.ImportFrom) and node.module == 'pathlib' or
             isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id in keys for target in node.targets)]
    namespace = {'__file__': str(script)}
    exec(compile(ast.Module(body=setup, type_ignores=[]), str(script), 'exec'), namespace)
    assert namespace['ROOT'] == root, name
    for key in keys - {'ROOT'}:
        if key not in namespace:
            continue
        asset = Path(namespace[key]).resolve()
        assert asset.is_relative_to(root), (name, key, asset)
        assert asset.exists(), (name, key, asset)
    if name == 'slice-expression-sheet.py':
        guard = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'require_f_output')
        exec(compile(ast.Module(body=[guard], type_ignores=[]), str(script), 'exec'), namespace)
        assert namespace['require_f_output'](root / '.tmp' / 'asset-preview') == root / '.tmp' / 'asset-preview'
        try:
            namespace['require_f_output'](Path('C:/gaia-forbidden-output'))
            raise AssertionError('C drive output must be rejected without writing')
        except ValueError:
            pass
`);
});

test('隔离切图使用正式中文映射，只有明确指定时生成预览', { skip: pythonSkip }, (t) => {
  if (spawnSync(python, ['-B', '-c', 'import PIL'], options).status !== 0) {
    t.skip('可选切图验证需要 Pillow');
    return;
  }
  runPython(String.raw`
import hashlib
import json
import subprocess
import sys
import tempfile
from pathlib import Path
from PIL import Image
root = Path(sys.argv[1]).resolve()
pet = root / 'src' / 'renderer' / 'images' / 'pet'
expected = set(json.loads((pet / 'pet-expressions.json').read_text(encoding='utf-8'))['cells'].values())
def original_hashes():
    return {str(file.relative_to(pet)): hashlib.sha256(file.read_bytes()).hexdigest() for file in pet.rglob('*.png')}
before = original_hashes()
with tempfile.TemporaryDirectory(prefix='gaia-lucky-asset-test-') as directory:
    isolated = Path(directory).resolve()
    source = isolated / 'source.webp'
    Image.new('RGBA', (1024, 2048), (20, 40, 60, 255)).save(source, lossless=True)
    output = isolated / 'result'
    command = [sys.executable, '-B', str(root / 'scripts' / 'slice-expression-sheet.py'), str(source), str(output)]
    subprocess.run(command, cwd=isolated, capture_output=True, check=True)
    assert {file.name for file in (output / 'cells').iterdir()} == expected
    assert {file.name for file in output.iterdir()} == {'cells'}
    with Image.open(output / 'cells' / '半身照.png') as body:
        assert body.size == (509, 647)
    with Image.open(output / 'cells' / '日常表情.png') as expression:
        assert expression.size == (256, 256)
    preview = isolated / 'preview' / 'annotated.png'
    subprocess.run(command + ['--preview', str(preview)], cwd=isolated, capture_output=True, check=True)
    assert preview.is_file()
assert original_hashes() == before, '切图验证不得改动实际桌宠素材'
`);
});

test('插画提取必须明确提供原图，帮助或无效输入不生成素材', { skip: pythonSkip }, () => {
  runPython(String.raw`
import ast
import subprocess
import sys
import tempfile
from pathlib import Path
root = Path(sys.argv[1]).resolve()
source = (root / 'scripts' / 'prepare-library-art.py').read_text(encoding='utf-8')
compile(ast.parse(source), 'prepare-library-art.py', 'exec')
with tempfile.TemporaryDirectory(prefix='gaia-lucky-art-args-test-') as directory:
    isolated = Path(directory).resolve()
    script = isolated / 'scripts' / 'prepare-library-art.py'
    script.parent.mkdir()
    script.write_text(source, encoding='utf-8')
    command = [sys.executable, '-B', str(script)]
    missing = subprocess.run(command, cwd=isolated, capture_output=True, text=True, encoding='utf-8')
    assert missing.returncode == 2 and 'source' in missing.stderr
    help_result = subprocess.run(command + ['--help'], cwd=isolated, capture_output=True, text=True, encoding='utf-8')
    assert help_result.returncode == 0 and 'source' in help_result.stdout and '必填' in help_result.stdout
    invalid = subprocess.run(command + [str(isolated / 'missing.jpg')], cwd=isolated, capture_output=True, text=True, encoding='utf-8')
    assert invalid.returncode == 2 and '输入文件不存在' in invalid.stderr
    for result in (missing, help_result, invalid):
        assert 'ModuleNotFoundError' not in result.stderr
    assert {file.name for file in isolated.iterdir()} == {'scripts'}
    assert {file.name for file in script.parent.iterdir()} == {'prepare-library-art.py'}
`);
});
