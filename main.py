from flask import Flask, jsonify
import mysql.connector
import requests

app = Flask(__name__)

#graph_api_url = "http://localhost:4000/graphql"

mydb = mysql.connector.connect(
  host="sql5.freesqldatabase.com",
  user="sql5432499",
  password="Lp5Tw8l2GR",
  database="sql5432499"
 )

cursor = mydb.cursor()

@app.route('/query')
def queryDB():
    '''
    query = """
        query {
            events {
                id,
                image,
                title,
                description,
                location
            }
        }
    """
    res = requests.post(graph_api_url, json  = { 'query' : query })
    return jsonify(res.text)
    '''
    cursor.execute("SELECT * FROM Events")
    res = cursor.fetchall()
    res_arr = []
    for val in res:
        res_arr.append(val)
    return jsonify(res_arr)
