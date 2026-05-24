# Pocket Wind Chimes

A tiny no-build web app that plays synthesized wind chime tones when an iPhone is shaken.

## Why this shape

The easiest shareable version is a static website:

- No Apple Developer Program account is needed.
- No audio files are needed because the chimes are made with the Web Audio API.
- Once hosted at an HTTPS URL, you can send the link by text.
- On iPhone, the first tap wakes audio and asks for motion permission.

## Try it locally

From this folder:

```sh
python3 -m http.server 8080
```

Then open:

```text
http://localhost:8080
```

The Test button works on a computer. Real shake detection needs a phone with motion sensors and, for iPhone Safari, an HTTPS page.

## Share it

The simplest durable path is GitHub Pages:

1. Put these files in a GitHub repository.
2. Enable Pages for the repository.
3. Open the published `https://...github.io/...` URL on the iPhone.
4. Text that URL to someone.
5. On iPhone, use Share -> Add to Home Screen to make it feel app-like.

Native iPhone distribution is heavier. A free Apple developer account can test on your own device through Xcode, but TestFlight/App Store sharing requires Apple Developer Program membership.
