from flask import Flask, jsonify
import mysql.connector
import requests

app = Flask(__name__)

mydb = mysql.connector.connect(
  host="sql5.freesqldatabase.com",
  user="sql5432499",
  password="Lp5Tw8l2GR",
  database="sql5432499"
 )

cursor = mydb.cursor()

@app.route('/query')
def queryDB():
    cursor.execute("SELECT * FROM Events")
    res = cursor.fetchall()
    res_arr = []
    for val in res:
        res_arr.append(val)
    return jsonify(res_arr)

@app.route('/addEvent')
def createEvent():
    sql = "INSERT into Events(id, image, title, description, location, other) VALUES {}, {}, {}, {}, {}, {}"
    params = list(request.args)
    sql.format(sql.format(params[0], params[1], params[2], params[3], params[4], params[5]))
    cursor.execute(sql)

@app.route('/getChats')
def returnChats():
    sql = "SELECT * FROM Chats WHERE Event={}"
    sql.format(list(request.args)[0])
    cursor.execute(sql)
    res = cursor.fetchall()
    res_arr = []
    for val in res:
        res_arr.append(val)
    return jsonify(res_arr)
