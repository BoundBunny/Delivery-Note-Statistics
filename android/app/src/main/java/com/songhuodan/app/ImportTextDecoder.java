package com.songhuodan.app;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.Charset;
import java.nio.charset.CodingErrorAction;

/** Strict offline text decoding: do not turn Excel/binary bytes into customer names. */
final class ImportTextDecoder {
    private ImportTextDecoder() {}

    private static String decodeAs(byte[] bytes, String charset) throws CharacterCodingException {
        return Charset.forName(charset).newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT)
                .decode(ByteBuffer.wrap(bytes)).toString();
    }

    static String decode(byte[] bytes) throws IOException {
        if ((bytes.length >= 2 && ((bytes[0] == 0x50 && bytes[1] == 0x4b)
                || (bytes[0] == (byte) 0xd0 && bytes[1] == (byte) 0xcf)))
                || (bytes.length >= 4 && bytes[0] == 0x25 && bytes[1] == 0x50
                && bytes[2] == 0x44 && bytes[3] == 0x46)) {
            throw new IOException("请选择 CSV 或 JSON 文本文件；Excel 文件请先另存为 CSV。");
        }
        String text;
        if (bytes.length >= 2 && bytes[0] == (byte) 0xff && bytes[1] == (byte) 0xfe) {
            text = decodeAs(bytes, "UTF-16LE");
        } else if (bytes.length >= 2 && bytes[0] == (byte) 0xfe && bytes[1] == (byte) 0xff) {
            text = decodeAs(bytes, "UTF-16BE");
        } else {
            try {
                text = decodeAs(bytes, "UTF-8");
            } catch (CharacterCodingException utf8Error) {
                if (bytes.length >= 3 && bytes[0] == (byte) 0xef && bytes[1] == (byte) 0xbb && bytes[2] == (byte) 0xbf) {
                    throw new IOException("UTF-8 文件已损坏，请重新导出原始 CSV。", utf8Error);
                }
                try { text = decodeAs(bytes, "GB18030"); }
                catch (CharacterCodingException error) {
                    throw new IOException("文件编码无法识别，请重新导出 UTF-8 CSV 文件。", error);
                }
            }
        }
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            if (c == '\ufffd' || c == 0x7f || (c < 0x20 && c != '\t' && c != '\r' && c != '\n')) {
                throw new IOException("文件包含乱码或二进制内容，请核对原始 CSV 文件。");
            }
        }
        return text.startsWith("\ufeff") ? text.substring(1) : text;
    }
}
