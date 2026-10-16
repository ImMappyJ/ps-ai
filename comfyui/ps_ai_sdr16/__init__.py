"""PS-AI optional SDR output node. GPL-3.0-only. No additional pip dependencies."""
import os
import re
import struct
import zlib
import numpy as np
import folder_paths


def _chunk(kind, data):
    return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data))


def _write_png(stream, pixels):
    height, width, channels = pixels.shape
    stream.write(b'\x89PNG\r\n\x1a\n')
    stream.write(_chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 16, 2 if channels == 3 else 6, 0, 0, 0)))
    stream.write(_chunk(b'sRGB', b'\x01'))
    compressor = zlib.compressobj()
    for row in pixels:
        packed = compressor.compress(b'\0' + row.astype('>u2').tobytes())
        if packed:
            stream.write(_chunk(b'IDAT', packed))
    stream.write(_chunk(b'IDAT', compressor.flush()))
    stream.write(_chunk(b'IEND', b''))


class PS_AISavePNG16:
    @classmethod
    def INPUT_TYPES(cls):
        return {'required': {'images': ('IMAGE',), 'filename_prefix': ('STRING', {'default': 'ps-ai/image'})}}

    RETURN_TYPES = ()
    FUNCTION = 'save_images'
    OUTPUT_NODE = True
    CATEGORY = 'image/PS-AI'
    DESCRIPTION = 'Save decoded SDR sRGB floats directly to 16-bit RGB/RGBA PNG. Does not create HDR or extra model precision.'

    def save_images(self, images, filename_prefix='ps-ai/image'):
        if not isinstance(filename_prefix, str) or len(filename_prefix) > 128 or not re.fullmatch(r'(?:[A-Za-z0-9_-]+/)*[A-Za-z0-9_-]+', filename_prefix):
            raise ValueError('Use a relative PS-AI filename prefix without traversal, drive letters or backslashes.')
        values = images.detach().cpu().float().numpy()
        if values.ndim != 4 or not 1 <= values.shape[0] <= 4 or values.shape[-1] not in (3, 4):
            raise ValueError('Expected 1–4 RGB/RGBA IMAGE tensors (batch, height, width, channels).')
        _, height, width, _ = values.shape
        if height < 1 or width < 1 or height * width > 16_000_000 or not np.isfinite(values).all():
            raise ValueError('Expected finite SDR pixels, at most 16 million pixels per image.')
        output = folder_paths.get_output_directory()
        folder, name, counter, subfolder, _ = folder_paths.get_save_image_path(filename_prefix, output, width, height)
        results = []
        for image in values:
            # Quantize once from the VAE float output. No intermediate uint8/Pillow conversion.
            pixels = np.rint(np.clip(image, 0, 1) * 65535).astype(np.uint16)
            while True:
                filename = f'{name}_{counter:05}_.png'
                path = os.path.join(folder, filename)
                try:
                    stream = open(path, 'xb')
                    break
                except FileExistsError:
                    counter += 1
            try:
                with stream:
                    _write_png(stream, pixels)
            except BaseException:
                os.remove(path)
                raise
            results.append({'filename': filename, 'subfolder': subfolder, 'type': 'output'})
            counter += 1
        return {'ui': {'images': results}}


NODE_CLASS_MAPPINGS = {'PS_AISavePNG16': PS_AISavePNG16}
NODE_DISPLAY_NAME_MAPPINGS = {'PS_AISavePNG16': 'PS-AI Save PNG16 (sRGB SDR)'}
