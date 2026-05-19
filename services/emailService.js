const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

// Validate required environment variables
const validateEnv = () => {
  const requiredVars = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS'];
  const missingVars = requiredVars.filter(v => !process.env[v]);

  if (missingVars.length) {
    console.error('❌ Missing required email environment variables:', missingVars);
    throw new Error('Missing email configuration');
  }
};

// Create transporter with enhanced configuration
const createTransporter = () => {
  validateEnv();

  const config = {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: process.env.SMTP_PORT === '465', 
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    },
    pool: true,
    maxConnections: 5,
    maxMessages: 100,
    rateDelta: 1000,
    rateLimit: 5,
    logger: true,
    debug: process.env.NODE_ENV !== 'production'
  };

  const transporter = nodemailer.createTransport(config);

  transporter.verify((error) => {
    if (error) {
      console.error('❌ SMTP Connection Error:', error);
    } else {
      console.log('✅ SMTP Connection Verified - Ready to send emails');
    }
  });

  return transporter;
};

// Lazy transporter creation
let _transporter = null;
const getTransporter = () => {
  if (!_transporter) {
    _transporter = createTransporter();
  }
  return _transporter;
};

/**
 * Enhanced email sending with retry logic
 */
const sendEmail = async (options, retries = 3) => {
  const mailOptions = {
    from: process.env.SMTP_FROM || `"Finance System" <${process.env.SMTP_USER}>`,
    to: options.to,
    subject: options.subject,
    text: options.text,
    html: options.html || generateHtmlFromText(options.text),
    attachments: options.attachments,
  };

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`📧 Attempt ${attempt}/${retries} to send email to ${options.to}`);
      const info = await getTransporter().sendMail(mailOptions);
      console.log('✅ Email sent successfully:', {
        messageId: info.messageId,
        accepted: info.accepted,
        rejected: info.rejected
      });
      return { 
        success: true, 
        messageId: info.messageId,
        accepted: info.accepted,
        response: info.response 
      };
    } catch (error) {
      console.error(`❌ Email attempt ${attempt} failed:`, {
        error: error.message,
        code: error.code,
        command: error.command
      });
      
      if (attempt === retries) {
        return { 
          success: false, 
          error: error.message,
          code: error.code,
          stack: process.env.NODE_ENV !== 'production' ? error.stack : undefined
        };
      }
      
      const delay = Math.min(2000 * Math.pow(2, attempt - 1), 30000);
      console.log(`⏳ Retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
};

/**
 * Generate HTML template from plain text
 */
const generateHtmlFromText = (text) => {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; border-left: 4px solid #007bff;">
        <h2 style="color: #333; margin-top: 0;">Finance System Notification</h2>
        <p style="color: #555; line-height: 1.6; margin-bottom: 20px;">
          ${text.replace(/\n/g, '<br>')}
        </p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
        <p style="color: #888; font-size: 12px; margin-bottom: 0;">
          This is an automated message from the Finance Management System. Please do not reply to this email.
        </p>
      </div>
    </div>
  `;
};

/**
 * Action Item Email Notifications
 */
const sendActionItemEmail = {
  taskCreationApproval: async (supervisorEmail, supervisorName, employeeName, title, description, priority, dueDate, taskId, projectName = null) => {
    try {
      const clientUrl = process.env.CLIENT_URL || 'http://localhost:3000';
      const taskLink = `${clientUrl}/action-items/${taskId}`;
      const formattedDueDate = new Date(dueDate).toLocaleDateString('en-US', { 
        weekday: 'long', 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
      });

      const priorityColors = {
        'LOW': '#28a745',
        'MEDIUM': '#17a2b8',
        'HIGH': '#ffc107',
        'CRITICAL': '#dc3545'
      };

      const priorityColor = priorityColors[priority] || '#6c757d';

      const subject = `🔔 Task Creation Approval Needed: ${title}`;
      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: #fff3cd; padding: 20px; border-radius: 8px; border-left: 4px solid #ffc107;">
            <h2 style="color: #856404; margin-top: 0;">🔔 Task Creation Needs Your Approval</h2>
            <p style="color: #856404; line-height: 1.6;">
              Dear ${supervisorName},
            </p>
            <p style="color: #856404; line-height: 1.6;">
              <strong>${employeeName}</strong> has created a new task${projectName ? ` for project <strong>${projectName}</strong>` : ''} and needs your approval before starting work.
            </p>

            <div style="background-color: white; padding: 20px; border-radius: 8px; margin: 20px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
              <h3 style="color: #333; margin-top: 0; border-bottom: 2px solid #ffc107; padding-bottom: 10px;">Task Details</h3>
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Task:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${title}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Description:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${description}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Created By:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${employeeName}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Priority:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">
                    <span style="background-color: ${priorityColor}; color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px;">
                      ${priority}
                    </span>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Due Date:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #dc3545; font-weight: bold;">
                    ${formattedDueDate}
                  </td>
                </tr>
                ${projectName ? `
                <tr>
                  <td style="padding: 8px 0;"><strong>Project:</strong></td>
                  <td style="padding: 8px 0;">${projectName}</td>
                </tr>
                ` : ''}
              </table>
            </div>

            <div style="text-align: center; margin: 30px 0;">
              <a href="${taskLink}" 
                 style="display: inline-block; background-color: #ffc107; color: #333; 
                        padding: 15px 30px; text-decoration: none; border-radius: 8px;
                        font-weight: bold; font-size: 16px; border: 2px solid #ffc107;">
                ✅ Review & Approve Task
              </a>
            </div>
          </div>
        </div>
      `;

      return await sendEmail({
        to: supervisorEmail,
        subject,
        html
      });

    } catch (error) {
      console.error('❌ Error in taskCreationApproval:', error);
      return { success: false, error: error.message };
    }
  },

  taskCreationApproved: async (userEmail, userName, supervisorName, title, taskId, comments = '') => {
    try {
      const clientUrl = process.env.CLIENT_URL || 'http://localhost:3000';
      const taskLink = `${clientUrl}/action-items/${taskId}`;

      const subject = `✅ Task Approved - You Can Start: ${title}`;
      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: #d4edda; padding: 20px; border-radius: 8px; border-left: 4px solid #28a745;">
            <h2 style="color: #155724; margin-top: 0;">✅ Task Approved - You Can Start!</h2>
            <p style="color: #155724; line-height: 1.6;">
              Dear ${userName},
            </p>
            <p style="color: #155724; line-height: 1.6; font-size: 16px;">
              Great news! Your supervisor <strong>${supervisorName}</strong> has approved your task "<strong>${title}</strong>". You can now start working on it.
            </p>
            ${comments ? `
            <div style="background-color: #e9ecef; padding: 15px; border-radius: 6px; margin: 20px 0;">
              <p style="color: #333; margin: 0;"><strong>Supervisor Comments:</strong></p>
              <p style="color: #555; margin: 10px 0 0 0; font-style: italic;">${comments}</p>
            </div>
            ` : ''}
            <div style="text-align: center; margin: 30px 0;">
              <a href="${taskLink}" 
                 style="display: inline-block; background-color: #28a745; color: white; 
                        padding: 15px 30px; text-decoration: none; border-radius: 8px;
                        font-weight: bold; font-size: 16px;">
                🚀 Start Working on Task
              </a>
            </div>
          </div>
        </div>
      `;

      return await sendEmail({
        to: userEmail,
        subject,
        html
      });

    } catch (error) {
      console.error('❌ Error in taskCreationApproved:', error);
      return { success: false, error: error.message };
    }
  },


};

/**
 * Generator Update Notification
 */
const generatorUpdateNotification = async (supervisorEmail, supervisorName, technicianName, siteId, siteName, updateType, generatorDetails, updateReason, updateId) => {
  try {
    const clientUrl = process.env.CLIENT_URL || 'http://localhost:3000';
    const updateLink = `${clientUrl}/admin/generator-updates/${updateId}`;
    
    const updateTypeLabels = {
      'status_update': 'Generator Status Update',
      'new_generator': 'New Generator Installation',
      'maintenance_update': 'Generator Maintenance Update'
    };

    const statusColors = {
      'running': '#28a745',
      'standby': '#17a2b8',
      'maintenance': '#ffc107',
      'fault': '#dc3545',
      'out_of_service': '#6c757d'
    };

    const statusColor = statusColors[generatorDetails.status] || '#6c757d';

    const subject = `⚡ Generator Update at ${siteName} - ${updateTypeLabels[updateType]}`;
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background-color: #e7f3ff; padding: 20px; border-radius: 8px; border-left: 4px solid #007bff;">
          <h2 style="color: #004085; margin-top: 0;">⚡ Generator Update Notification</h2>
          <p style="color: #004085; line-height: 1.6;">
            Dear ${supervisorName},
          </p>
          <p style="color: #004085; line-height: 1.6;">
            <strong>${technicianName}</strong> has submitted a ${updateTypeLabels[updateType].toLowerCase()} for <strong>${siteName}</strong>.
          </p>

          <div style="background-color: white; padding: 20px; border-radius: 8px; margin: 20px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <h3 style="color: #333; margin-top: 0; border-bottom: 2px solid #007bff; padding-bottom: 10px;">Update Details</h3>
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Update Type:</strong></td>
                <td style="padding: 8px 0; border-bottom: 1px solid #eee;">
                  <span style="background-color: #007bff; color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px;">
                    ${updateTypeLabels[updateType]}
                  </span>
                </td>
              </tr>
              <tr>
                <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Site ID:</strong></td>
                <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${siteId}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Site Name:</strong></td>
                <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${siteName}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Status:</strong></td>
                <td style="padding: 8px 0; border-bottom: 1px solid #eee;">
                  <span style="background-color: ${statusColor}; color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px;">
                    ${generatorDetails.status.toUpperCase()}
                  </span>
                </td>
              </tr>
            </table>
          </div>

          <div style="background-color: #fff3cd; padding: 15px; border-radius: 6px; margin: 20px 0; border-left: 4px solid #ffc107;">
            <p style="color: #856404; margin: 0;"><strong>Update Reason:</strong></p>
            <p style="color: #856404; margin: 10px 0 0 0; font-style: italic;">${updateReason}</p>
          </div>

          <div style="text-align: center; margin: 30px 0;">
            <a href="${updateLink}" 
               style="display: inline-block; background-color: #007bff; color: white; 
                      padding: 15px 30px; text-decoration: none; border-radius: 8px;
                      font-weight: bold; font-size: 16px;">
              📋 View Full Update Details
            </a>
          </div>
        </div>
      </div>
    `;

    return await sendEmail({
      to: supervisorEmail,
      subject,
      html
    });

  } catch (error) {
    console.error('❌ Error in generatorUpdateNotification:', error);
    return { success: false, error: error.message };
  }
};

// Export all functions
module.exports = {
  sendEmail,
  sendActionItemEmail,
  generatorUpdateNotification,
  getTransporter
};



