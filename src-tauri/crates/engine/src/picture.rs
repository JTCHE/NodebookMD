//! A picture's size, read from the head of its file. The install ships JPEG,
//! PNG, SVG and GIF pictures; the head of each says how large it is, so the
//! page can hold the picture's room before the file arrives.
//!
//! ponytail: a JPEG's EXIF rotation is not read. The browser turns such a
//! picture, and its room comes out on its side until it loads. No help
//! picture carries one today.

use wiki::Size;

/// How much of a file `size` may need. A JPEG can carry a thumbnail and a
/// colour profile before the frame header.
pub const HEAD: u64 = 64 * 1024;

pub fn size(head: &[u8]) -> Option<Size> {
    let fixed = |width: u32, height: u32| {
        (width > 0 && height > 0).then_some(Size {
            width,
            height,
            fixed: true,
        })
    };
    let be16 = |at: usize| Some(u16::from_be_bytes([*head.get(at)?, *head.get(at + 1)?]) as u32);
    let be32 = |at: usize| Some(u32::from_be_bytes(head.get(at..at + 4)?.try_into().ok()?));
    if head.starts_with(b"\x89PNG\r\n\x1a\n") {
        return fixed(be32(16)?, be32(20)?);
    }
    if head.starts_with(b"GIF8") {
        let le16 =
            |at: usize| Some(u16::from_le_bytes([*head.get(at)?, *head.get(at + 1)?]) as u32);
        return fixed(le16(6)?, le16(8)?);
    }
    if head.starts_with(&[0xFF, 0xD8]) {
        let mut at = 2;
        loop {
            while *head.get(at)? != 0xFF {
                at += 1;
            }
            while *head.get(at)? == 0xFF {
                at += 1;
            }
            let marker = *head.get(at)?;
            at += 1;
            // Markers that stand alone, with no length after them.
            if marker == 0x01 || (0xD0..=0xD9).contains(&marker) {
                continue;
            }
            // A frame header: SOF0 to SOF15, less DHT, JPG and DAC.
            if (0xC0..=0xCF).contains(&marker) && ![0xC4, 0xC8, 0xCC].contains(&marker) {
                return fixed(be16(at + 5)?, be16(at + 3)?);
            }
            at += be16(at)? as usize;
        }
    }
    svg(&String::from_utf8_lossy(head))
}

/// The `<svg>` tag's own `width` and `height`, in pixels, or else the ratio
/// of its `viewBox`. A width in `%` or `em` is no width of its own.
fn svg(text: &str) -> Option<Size> {
    let start = text.find("<svg")?;
    let tag = &text[start..start + text[start..].find('>')?];
    let attribute = |name: &str| {
        let at = tag
            .match_indices(name)
            .find(|(at, _)| tag[..*at].ends_with(char::is_whitespace))?
            .0
            + name.len();
        let rest = tag[at..].trim_start().strip_prefix('=')?.trim_start();
        let quote = rest.chars().next().filter(|c| *c == '"' || *c == '\'')?;
        Some(&rest[1..1 + rest[1..].find(quote)?])
    };
    let pixels = |value: &str| {
        let value = value.trim();
        value
            .strip_suffix("px")
            .unwrap_or(value)
            .parse::<f32>()
            .ok()
            .filter(|n| *n > 0.0)
    };
    if let (Some(width), Some(height)) = (
        attribute("width").and_then(pixels),
        attribute("height").and_then(pixels),
    ) {
        return Some(Size {
            width: width.round() as u32,
            height: height.round() as u32,
            fixed: true,
        });
    }
    let view: Vec<f32> = attribute("viewBox")?
        .split([' ', ',', '\t', '\n'])
        .filter(|part| !part.is_empty())
        .filter_map(|part| part.parse().ok())
        .collect();
    let [_, _, width, height] = view[..] else {
        return None;
    };
    (width > 0.0 && height > 0.0).then(|| Size {
        width: width.round() as u32,
        height: height.round() as u32,
        fixed: false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixed(width: u32, height: u32) -> Option<Size> {
        Some(Size {
            width,
            height,
            fixed: true,
        })
    }

    #[test]
    fn reads_each_format() {
        let mut png = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR".to_vec();
        png.extend(640u32.to_be_bytes());
        png.extend(480u32.to_be_bytes());
        assert_eq!(size(&png), fixed(640, 480));

        assert_eq!(size(b"GIF89a\x80\x02\xe0\x01"), fixed(640, 480));

        // SOI, an APP0 of 16 bytes, then SOF0: length, precision, height, width.
        let mut jpeg = vec![0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10];
        jpeg.extend([0; 14]);
        jpeg.extend([0xFF, 0xC0, 0x00, 0x11, 0x08, 0x01, 0xE0, 0x02, 0x80]);
        assert_eq!(size(&jpeg), fixed(640, 480));

        assert_eq!(
            size(br#"<?xml?><svg xmlns="x" width="64px" height='32' viewBox="0 0 1 1">"#),
            fixed(64, 32)
        );
        assert_eq!(
            size(br#"<svg width="100%" viewBox="0 0 300 150">"#),
            Some(Size {
                width: 300,
                height: 150,
                fixed: false
            })
        );
        assert_eq!(size(b"not a picture"), None);
        assert_eq!(size(&[0xFF, 0xD8, 0xFF, 0xE0]), None);
    }
}
