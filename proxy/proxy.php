<?php

declare(strict_types=1);

/**
 * Minimal reverse proxy that lets the GoReady front-end reach the intervals.icu
 * API without running into browser CORS restrictions.
 *
 * It holds no credentials of its own: it simply forwards the Authorization
 * header and body it receives, as-is, to https://intervals.icu/api/v1/<path>.
 *
 * Deploy this file next to (or reachable from) the built GoReady SPA and point
 * the app's "Proxy URL" setting at it.
 */

// Restrict this to your own domain in production, e.g. 'https://your-site.example'.
const ALLOWED_ORIGIN = '*';
const INTERVALS_API_BASE = 'https://intervals.icu/api/v1/';
const ALLOWED_METHODS = ['GET', 'PUT'];

header('Access-Control-Allow-Origin: ' . ALLOWED_ORIGIN);
header('Access-Control-Allow-Headers: Authorization, Content-Type');
header('Access-Control-Allow-Methods: GET, PUT, OPTIONS');

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'OPTIONS') {
    // CORS preflight: no body, nothing to forward.
    http_response_code(204);
    exit;
}

if (!in_array($method, ALLOWED_METHODS, true)) {
    respondJson(405, ['error' => 'Method not allowed']);
}

$path = $_GET['path'] ?? '';
if (!is_string($path) || !isValidApiPath($path)) {
    respondJson(400, ['error' => 'Invalid path']);
}

$authorization = getAuthorizationHeader();
if ($authorization === '') {
    respondJson(401, ['error' => 'Missing Authorization header']);
}

$body = $method === 'PUT' ? file_get_contents('php://input') : null;
$response = forwardToIntervals($method, $path, $authorization, $body === false ? null : $body);

http_response_code($response['status']);
if ($response['contentType'] !== null) {
    header('Content-Type: ' . $response['contentType']);
}
echo $response['body'];
exit;

/**
 * Rejects anything that isn't a plain relative path (optionally with a query
 * string) under the intervals.icu API base, so this proxy can't be turned into
 * an open relay to arbitrary hosts (SSRF).
 */
function isValidApiPath(string $path): bool
{
    if ($path === '') {
        return false;
    }
    if (strpos($path, '..') !== false) {
        return false;
    }
    if (preg_match('#^[a-zA-Z][a-zA-Z0-9+.-]*://#', $path)) {
        return false; // absolute URL, e.g. "https://evil.example/..."
    }
    if (strpos($path, '/') === 0) {
        return false; // protocol-relative ("//host/...") or absolute ("/...") path
    }
    return true;
}

/**
 * Reads the Authorization header. Some Apache/PHP-FPM setups strip it from
 * $_SERVER['HTTP_AUTHORIZATION'] by default, so a couple of fallbacks are used.
 */
function getAuthorizationHeader(): string
{
    if (!empty($_SERVER['HTTP_AUTHORIZATION'])) {
        return $_SERVER['HTTP_AUTHORIZATION'];
    }
    if (!empty($_SERVER['REDIRECT_HTTP_AUTHORIZATION'])) {
        return $_SERVER['REDIRECT_HTTP_AUTHORIZATION'];
    }
    if (function_exists('getallheaders')) {
        foreach (getallheaders() as $name => $value) {
            if (strcasecmp($name, 'Authorization') === 0) {
                return $value;
            }
        }
    }
    return '';
}

/**
 * @return array{status: int, contentType: ?string, body: string}
 */
function forwardToIntervals(string $method, string $path, string $authorization, ?string $body): array
{
    $url = INTERVALS_API_BASE . $path;

    $headers = ['Accept: application/json', 'Authorization: ' . $authorization];
    if ($body !== null) {
        $headers[] = 'Content-Type: application/json';
    }

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HEADER => true,
        CURLOPT_TIMEOUT => 20,
    ]);
    if ($body !== null) {
        curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
    }

    $raw = curl_exec($ch);
    if ($raw === false) {
        $error = curl_error($ch);
        curl_close($ch);
        return ['status' => 502, 'contentType' => 'application/json', 'body' => json_encode(['error' => $error])];
    }

    $headerSize = (int) curl_getinfo($ch, CURLINFO_HEADER_SIZE);
    $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $contentType = curl_getinfo($ch, CURLINFO_CONTENT_TYPE) ?: null;
    curl_close($ch);

    return ['status' => $status, 'contentType' => $contentType, 'body' => substr($raw, $headerSize)];
}

/**
 * Sends a JSON error response and terminates the script.
 *
 * @param array<mixed> $payload
 */
function respondJson(int $status, array $payload): void
{
    http_response_code($status);
    header('Content-Type: application/json');
    echo json_encode($payload);
    exit;
}
