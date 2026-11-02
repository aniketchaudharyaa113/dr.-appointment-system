FROM nginx:1.27-alpine

COPY infra/nginx/nginx.conf /etc/nginx/nginx.conf
COPY infra/nginx/conf.d/ /etc/nginx/conf.d/

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
