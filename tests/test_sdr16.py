"""Independent PNG contract tests; run with ComfyUI's Python (NumPy already installed)."""
import importlib.util
import pathlib
import struct
import sys
import tempfile
import types
import unittest
import zlib
import numpy as np

class Tensor:
    def __init__(self, data): self.data = data
    def detach(self): return self
    def cpu(self): return self
    def float(self): return self
    def numpy(self): return self.data

class Save16Tests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = self.tmp.name
        def get_path(prefix, output, w, h):
            folder = pathlib.Path(output, pathlib.PurePosixPath(prefix).parent)
            folder.mkdir(parents=True, exist_ok=True)
            return str(folder), pathlib.PurePosixPath(prefix).name, 1, str(pathlib.PurePosixPath(prefix).parent), prefix
        sys.modules['folder_paths'] = types.SimpleNamespace(get_output_directory=lambda: root, get_save_image_path=get_path)
        spec = importlib.util.spec_from_file_location('ps_ai_sdr16', pathlib.Path(__file__).resolve().parents[1] / 'comfyui/ps_ai_sdr16/__init__.py')
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)

    def tearDown(self): self.tmp.cleanup()

    def test_direct_float_preserves_non8_values_rgb_and_rgba(self):
        for channels in (3, 4):
            expected = np.array([12345, 23456, 34567, 45678][:channels], dtype=np.uint16)
            image = np.tile(expected.astype(np.float32) / 65535, (1, 2, 3, 1))
            saved = self.module.NODE_CLASS_MAPPINGS['PS_AISavePNG16']().save_images(Tensor(image), 'ps-ai/test')
            entry = saved['ui']['images'][0]
            data = pathlib.Path(self.tmp.name, entry['subfolder'], entry['filename']).read_bytes()
            at, parts, tags = 8, [], {}
            while at < len(data):
                length = struct.unpack_from('>I', data, at)[0]
                kind, payload = data[at+4:at+8], data[at+8:at+8+length]
                self.assertEqual(zlib.crc32(kind + payload), struct.unpack_from('>I', data, at+8+length)[0])
                if kind == b'IDAT': parts.append(payload)
                tags[kind] = payload
                at += length + 12
            self.assertEqual(tags[b'IHDR'][8:10], bytes((16, 2 if channels == 3 else 6)))
            self.assertEqual(tags[b'sRGB'], b'\x01')
            raw = zlib.decompress(b''.join(parts))
            self.assertEqual(np.frombuffer(raw[1:1+channels*2], dtype='>u2').tolist(), expected.tolist())
            self.assertEqual(entry['type'], 'output')

    def test_invalid_input_and_path_are_rejected(self):
        save = self.module.NODE_CLASS_MAPPINGS['PS_AISavePNG16']().save_images
        for prefix in ('../escape', '/absolute', 'C:/bad', 'ps-ai/../bad', 'x\\y'):
            with self.assertRaises(ValueError): save(Tensor(np.ones((1,1,1,3))), prefix)
        for shape in ((1,1,3), (1,1,1,1), (0,1,1,3)):
            with self.assertRaises(ValueError): save(Tensor(np.ones(shape)), 'ps-ai/test')
        with self.assertRaises(ValueError): save(Tensor(np.full((1,1,1,3), np.nan)), 'ps-ai/test')

if __name__ == '__main__': unittest.main()
