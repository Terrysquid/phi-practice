#version 300 es
precision highp float;

uniform vec2 _ScreenParams;
uniform vec2 _Time;
uniform sampler2D _TouchHoverRT;
uniform sampler2D _ComposeRT;
uniform sampler2D _TouchDisplaceMap;
uniform sampler2D _NoiseMap;
uniform int _TouchPosCount;
uniform vec2 _TouchPos[10];
in vec2 uv;
out vec4 color;

vec2 pixelate(vec2 p, float size) {
    return (floor(p * _ScreenParams / size) + 0.5) * size / _ScreenParams;
}

vec2 displacement(vec2 p, float speed, float pixelSize) {
    vec2 direction = normalize(vec2(1.0));
    vec2 perpendicular = vec2(-direction.y, direction.x);
    float t = _Time.x * speed;
    float a = textureLod(_TouchDisplaceMap, pixelate(p + direction * t, pixelSize), 0.0).r - 0.5;
    float b = textureLod(_TouchDisplaceMap, pixelate(p + perpendicular * t, pixelSize), 0.0).r - 0.5;
    return direction * a + perpendicular * b;
}

float hash12(vec2 p) {
    vec3 q = fract(p.xyx * 0.1031);
    q += dot(q, q.yxx + 33.33);
    return fract((q.x + q.y) * q.x);
}

vec2 noiseDirection(float phase) {
    return vec2(hash12(vec2(phase, 3.7)), hash12(vec2(phase, 9.1))) * 2.0 - 1.0;
}

vec2 cellPoint(vec2 cell) {
    return vec2(hash12(cell), hash12(cell + 17.17));
}

vec3 touchEffect() {
    if (texture(_TouchHoverRT, uv).r <= 0.0001) return vec3(0.0);
    vec2 offset = displacement(uv * vec2(0.55, 0.3), 2.9, 8.0);
    float mask = textureLod(_TouchHoverRT, uv + offset * 0.08, 0.0).r;

    float phase = _Time.y * 60.0;
    vec2 direction = mix(noiseDirection(floor(phase)), noiseDirection(floor(phase) + 1.0),
        smoothstep(0.0, 1.0, fract(phase)));
    vec2 noise = textureLod(_NoiseMap, uv * vec2(1.5, 1.46) + direction * 0.03, 0.0).rg;
    vec2 cellPosition = uv * _ScreenParams / (_ScreenParams.y * 0.11) + (noise - 0.5) * 2.0;
    phase = _Time.y * 9.3;
    vec2 cell = floor(cellPosition) + floor(phase);
    vec2 point = mix(cellPoint(cell), cellPoint(cell + 1.0), smoothstep(0.0, 1.0, fract(phase)));
    float sdf = smoothstep(0.34, 0.34 + 0.63, length(fract(cellPosition) - point));
    vec3 pattern = clamp(sdf * vec3(2.0, 1.0, 1.0), 0.0, 1.0) * smoothstep(0.48 - 1.0, 0.48 + 1.0, mask);
    vec3 glow = vec3(smoothstep(0.0, 1.0, mask), 0.0, 0.0);
    vec3 overlay = mix(2.0 * pattern * glow, 1.0 - 2.0 * (1.0 - pattern) * (1.0 - glow), step(0.5, pattern));
    return clamp(overlay, 0.0, 1.0) + 0.5 * glow;
}

float touchBrightness() {
    if (_TouchPosCount == 0) return 0.0;
    vec2 position = (uv + displacement(uv * vec2(0.8, 0.3), 1.5, 6.0) * 0.15) * _ScreenParams / _ScreenParams.y;
    float distanceToTouch = 1.0;
    for (int i = 0; i < 10; i++) {
        if (i >= _TouchPosCount) break;
        float d = distance(position, _TouchPos[i]);
        float h = max(0.47 - abs(distanceToTouch - d), 0.0) / 0.47;
        distanceToTouch = min(distanceToTouch, d) - h * h * 0.47 * 0.25;
    }
    float falloff = pow(smoothstep(0.0, 1.0, 1.0 - distanceToTouch / 0.5), 0.41);
    float shine = 2.0 * (0.63 + 0.37 * (0.5 + 0.5 * sin(43.0 * _Time.y)));
    return falloff * shine;
}

void main() {
    color = vec4(0.0, 0.0, 0.0, 1.0);
    if (abs(uv.x - 0.5) > _ScreenParams.y * (8.0 / 9.0) / _ScreenParams.x) return;
    vec4 region = texture(_ComposeRT, uv);
    color.rgb = touchEffect() + region.rgb * 0.3 * touchBrightness();
}
