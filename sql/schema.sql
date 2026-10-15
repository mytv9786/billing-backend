CREATE DATABASE IF NOT EXISTS billpro CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- App ki root vaadakunda separate user (password marchandi)
CREATE USER IF NOT EXISTS 'billpro'@'localhost' IDENTIFIED BY 'your_db_password';
GRANT ALL PRIVILEGES ON billpro.* TO 'billpro'@'localhost';
FLUSH PRIVILEGES;

USE billpro;

CREATE TABLE distributors (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  invoice_prefix VARCHAR(5) NOT NULL,
  invoice_seq INT NOT NULL DEFAULT 0,
  gstin VARCHAR(15) NULL,
  phone VARCHAR(20) NULL,
  address VARCHAR(255) NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_distributor_prefix (invoice_prefix)
);

CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  distributor_id INT NULL,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(190) NOT NULL,
  password_hash VARCHAR(100) NOT NULL,
  role ENUM('super_admin','admin','cashier','sales') NOT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_user_email (email),
  CONSTRAINT fk_user_distributor FOREIGN KEY (distributor_id) REFERENCES distributors(id)
);

CREATE TABLE products (
  id INT AUTO_INCREMENT PRIMARY KEY,
  distributor_id INT NOT NULL,
  name VARCHAR(150) NOT NULL,
  sku VARCHAR(50) NOT NULL,
  price DECIMAL(12,2) NOT NULL,
  tax_percent DECIMAL(5,2) NOT NULL DEFAULT 0,
  stock INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_product_sku (distributor_id, sku),
  CONSTRAINT fk_product_distributor FOREIGN KEY (distributor_id) REFERENCES distributors(id)
);

CREATE TABLE customers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  distributor_id INT NOT NULL,
  name VARCHAR(150) NOT NULL,
  phone VARCHAR(20) NOT NULL,
  phone_digits VARCHAR(15) NOT NULL,
  address VARCHAR(255) NULL,
  gstin VARCHAR(15) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_customer_phone (distributor_id, phone_digits),
  CONSTRAINT fk_customer_distributor FOREIGN KEY (distributor_id) REFERENCES distributors(id)
);

CREATE TABLE invoices (
  id INT AUTO_INCREMENT PRIMARY KEY,
  distributor_id INT NOT NULL,
  invoice_no VARCHAR(30) NOT NULL,
  customer_id INT NOT NULL,
  created_by INT NULL,
  subtotal DECIMAL(12,2) NOT NULL,
  tax DECIMAL(12,2) NOT NULL,
  discount DECIMAL(12,2) NOT NULL DEFAULT 0,
  total DECIMAL(12,2) NOT NULL,
  received DECIMAL(12,2) NOT NULL DEFAULT 0,
  invoice_date DATE NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_invoice_no (distributor_id, invoice_no),
  KEY idx_invoice_date (distributor_id, invoice_date),
  KEY idx_invoice_customer (distributor_id, customer_id),
  CONSTRAINT fk_invoice_distributor FOREIGN KEY (distributor_id) REFERENCES distributors(id),
  CONSTRAINT fk_invoice_customer FOREIGN KEY (customer_id) REFERENCES customers(id),
  CONSTRAINT fk_invoice_user FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE invoice_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  invoice_id INT NOT NULL,
  product_id INT NOT NULL,
  qty INT NOT NULL,
  price DECIMAL(12,2) NOT NULL,
  tax_percent DECIMAL(5,2) NOT NULL,
  CONSTRAINT fk_item_invoice FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
  CONSTRAINT fk_item_product FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE TABLE payments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  distributor_id INT NOT NULL,
  invoice_id INT NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  mode ENUM('cash','upi','card') NOT NULL,
  payment_date DATE NOT NULL,
  created_by INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_payment_invoice (invoice_id),
  CONSTRAINT fk_payment_invoice FOREIGN KEY (invoice_id) REFERENCES invoices(id),
  CONSTRAINT fk_payment_user FOREIGN KEY (created_by) REFERENCES users(id)
);