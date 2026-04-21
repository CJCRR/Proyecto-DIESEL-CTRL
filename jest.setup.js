process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'jwt_test_secret_not_for_production';
process.env.ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
process.env.SUPERADMIN_USERNAME = process.env.SUPERADMIN_USERNAME || 'superadmin';
process.env.SUPERADMIN_PASSWORD = process.env.SUPERADMIN_PASSWORD || 'superadmin123';
