<?php
// db.php - الاتصال بقاعدة البيانات
define('DB_HOST','sql310.infinityfree.com');
define('DB_USER','if0_41828499');
define('DB_PASS','JYcbsoQhNFl9Io');
define('DB_NAME','if0_41828499_dwich');
define('DB_CHARSET','utf8mb4');
define('UPLOAD_DIR', __DIR__ . '/uploads/');
define('UPLOAD_URL', 'uploads/');

function getDB(): PDO {
    static $pdo = null;
    if ($pdo === null) {
        $dsn = "mysql:host=".DB_HOST.";dbname=".DB_NAME.";charset=".DB_CHARSET;
        $pdo = new PDO($dsn, DB_USER, DB_PASS, [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
        ]);
    }
    return $pdo;
}

function query(string $sql, array $p = []): array {
    $s = getDB()->prepare($sql); $s->execute($p); return $s->fetchAll();
}
function queryOne(string $sql, array $p = []): ?array {
    $s = getDB()->prepare($sql); $s->execute($p); return $s->fetch() ?: null;
}
function execute(string $sql, array $p = []): int {
    $s = getDB()->prepare($sql); $s->execute($p);
    return (int)(getDB()->lastInsertId() ?: $s->rowCount());
}
function jsonResponse(bool $ok, $data = null, string $msg = ''): void {
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['success'=>$ok,'data'=>$data,'message'=>$msg], JSON_UNESCAPED_UNICODE);
    exit;
}
function clean(string $s): string { return htmlspecialchars(strip_tags(trim($s))); }

// رفع الصورة
function uploadImage(array $file, string $prefix = 'img'): ?string {
    if (!isset($file['tmp_name']) || !is_uploaded_file($file['tmp_name'])) return null;
    $ext = strtolower(pathinfo($file['name'], PATHINFO_EXTENSION));
    if (!in_array($ext, ['jpg','jpeg','png','gif','webp'])) return null;
    if ($file['size'] > 5 * 1024 * 1024) return null;
    if (!is_dir(UPLOAD_DIR)) mkdir(UPLOAD_DIR, 0755, true);
    $name = $prefix . '_' . time() . '_' . rand(100,999) . '.' . $ext;
    if (move_uploaded_file($file['tmp_name'], UPLOAD_DIR . $name)) return UPLOAD_URL . $name;
    return null;
}

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }