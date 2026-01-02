import serverless from 'serverless-http';
import { app, bootstrap } from '../../packages/api/src/index';

// Initialize the application logic (DB connections, etc)
// We start this immediately but await it in the handler to ensure readiness
const setupPromise = bootstrap();

// Wrap the Express app with serverless-http
const httpHandler = serverless(app);

export const handler = async (event: any, context: any) => {
    // Ensure app is initialized
    await setupPromise;

    // Forward request to Express
    // Note: serverless-http handles the event/context adaptation
    return httpHandler(event, context);
};
