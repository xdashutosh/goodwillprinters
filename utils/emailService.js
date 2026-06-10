const nodemailer = require('nodemailer');

// Set up a basic nodemailer transport (for now just logs, or you can configure SMTP)
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.ethereal.email',
  port: process.env.SMTP_PORT || 587,
  auth: {
      user: process.env.SMTP_USER || 'test@ethereal.email',
      pass: process.env.SMTP_PASS || 'pass123'
  }
});

const sendEmail = async (to, subject, text) => {
  try {
    // In a real scenario, use actual SMTP. 
    // Here we'll just log it to console to simulate if SMTP vars are missing
    if (!process.env.SMTP_HOST) {
      console.log('--- EMAIL SIMULATION ---');
      console.log('To:', to);
      console.log('Subject:', subject);
      console.log('Text:', text);
      console.log('------------------------');
      return true;
    }

    const info = await transporter.sendMail({
      from: '"Plan.A.Day" <noreply@plan-a-day.com>',
      to,
      subject,
      text,
    });
    console.log('Message sent: %s', info.messageId);
    return true;
  } catch (error) {
    console.error('Email send failed:', error);
    throw error;
  }
};

module.exports = sendEmail;
